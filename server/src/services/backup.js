/**
 * Backups. The photos family members upload are the one thing here that can't
 * be recreated, so this runs on a schedule and keeps several generations.
 *
 * Two details that matter:
 *  - The database is copied with SQLite's own backup API, not `cp`. Copying a
 *    live WAL database by hand can capture a torn state that won't open.
 *  - Photo originals are immutable once uploaded, so each generation *hardlinks*
 *    them instead of copying. Ten backups of 20GB of photos cost ~20GB, not
 *    200GB. Falls back to a real copy across filesystems (EXDEV).
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, nowIso } from '../db.js';
import { DATA_DIR, ORIGINALS_DIR } from '../paths.js';

const PREFIX = 'frame-backup-';

export function backupRoot() {
  const configured = (getSetting('backup_path') || '').trim();
  return configured || path.join(DATA_DIR, 'backups');
}

function folderStamp(date) {
  // Second resolution, or two runs in the same minute overwrite each other.
  // Sortable and filesystem-safe: frame-backup-20260805T143802
  return `${PREFIX}${date.toISOString().slice(0, 19).replace(/[:-]/g, '')}`;
}

function dirSize(dir) {
  let total = 0;
  let files = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
          files += 1;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  walk(dir);
  return { bytes: total, files };
}

/** Hardlink where possible; copy when the destination is another filesystem. */
function linkOrCopy(source, target) {
  try {
    fs.linkSync(source, target);
    return 'linked';
  } catch (err) {
    if (err.code === 'EEXIST') return 'linked';
    fs.copyFileSync(source, target);
    return 'copied';
  }
}

/** Never reuse a directory — two runs in the same second must not merge. */
function reserveTarget(root) {
  const stamp = folderStamp(new Date());
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = path.join(root, suffix ? `${stamp}-${suffix}` : stamp);
    try {
      // Fails with EEXIST rather than silently reusing, which is the point.
      fs.mkdirSync(candidate, { recursive: false });
      return candidate;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free backup directory name');
}

export async function runBackup() {
  const root = backupRoot();
  let target;

  try {
    fs.mkdirSync(root, { recursive: true });
    target = reserveTarget(root);
  } catch (err) {
    const message = `Cannot write to ${root}: ${err.message}`;
    console.error(`[backup] ${message}`);
    return { ok: false, error: message };
  }

  try {
    // Consistent DB snapshot — better-sqlite3 exposes SQLite's backup API.
    await db.backup(path.join(target, 'frame.db'));

    const photoDir = path.join(target, 'originals');
    fs.mkdirSync(photoDir, { recursive: true });

    let linked = 0;
    let copied = 0;
    for (const name of fs.existsSync(ORIGINALS_DIR) ? fs.readdirSync(ORIGINALS_DIR) : []) {
      const source = path.join(ORIGINALS_DIR, name);
      if (!fs.statSync(source).isFile()) continue;
      const mode = linkOrCopy(source, path.join(photoDir, name));
      if (mode === 'linked') linked += 1;
      else copied += 1;
    }

    const size = dirSize(target);
    fs.writeFileSync(
      path.join(target, 'manifest.json'),
      JSON.stringify(
        { createdAt: nowIso(), photos: linked + copied, linked, copied, bytes: size.bytes },
        null,
        2
      )
    );

    const pruned = pruneOldBackups();
    console.log(`[backup] wrote ${target} (${linked + copied} photos, ${pruned} pruned)`);
    return { ok: true, path: target, photos: linked + copied, bytes: size.bytes, pruned };
  } catch (err) {
    console.error(`[backup] failed: ${err.message}`);
    // Don't leave a half-written generation behind to be mistaken for good.
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    return { ok: false, error: err.message };
  }
}

function pruneOldBackups() {
  const keep = Math.max(1, Number(getSetting('backup_keep')) || 7);
  const root = backupRoot();
  if (!fs.existsSync(root)) return 0;

  const generations = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX))
    .map((e) => e.name)
    .sort()
    .reverse();

  let pruned = 0;
  for (const name of generations.slice(keep)) {
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
      pruned += 1;
    } catch (err) {
      console.error(`[backup] could not prune ${name}: ${err.message}`);
    }
  }
  return pruned;
}

export function listBackups() {
  const root = backupRoot();
  if (!fs.existsSync(root)) return { root, backups: [] };

  const backups = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX))
    .map((e) => {
      const dir = path.join(root, e.name);
      let manifest = null;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      } catch {
        /* older or interrupted generation */
      }
      return {
        name: e.name,
        createdAt: manifest?.createdAt ?? fs.statSync(dir).mtime.toISOString(),
        photos: manifest?.photos ?? null,
        bytes: manifest?.bytes ?? null,
        complete: !!manifest,
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return { root, backups };
}

/** True when the newest backup is older than ~2 days — surfaced in health. */
export function backupIsStale() {
  const { backups } = listBackups();
  if (!backups.length) return true;
  return Date.now() - new Date(backups[0].createdAt).getTime() > 2 * 24 * 60 * 60 * 1000;
}

let timer = null;

export function startBackupSchedule() {
  const run = async () => {
    if (getSetting('backup_enabled') === 'true') {
      await runBackup().catch((err) => console.error('[backup]', err));
    }
    const hours = Math.max(1, Number(getSetting('backup_every_hours')) || 24);
    timer = setTimeout(run, hours * 60 * 60 * 1000);
    timer.unref?.();
  };
  // Wait a minute after boot so the first run doesn't compete with startup.
  timer = setTimeout(run, 60_000);
  timer.unref?.();
}

export function stopBackupSchedule() {
  if (timer) clearTimeout(timer);
  timer = null;
}
