/**
 * Storage accounting for the admin System panel.
 *
 * The one thing worth being careful about: backups hardlink the photo
 * originals, so their apparent size double-counts what's already on disk.
 * Summing it naively would show a 20GB library as using 160GB. Files with more
 * than one link are reported as *shared* rather than as extra cost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { DATA_DIR, DB_PATH, DERIVED_DIR, ORIGINALS_DIR } from '../paths.js';
import { backupRoot } from './backup.js';

const CACHE_MS = 5 * 60 * 1000;
let cache = null;

/**
 * Walks a directory summing sizes. `unique` counts only files that aren't
 * hardlinked elsewhere — i.e. the space actually reclaimed by deleting them.
 */
function measure(dir) {
  let bytes = 0;
  let unique = 0;
  let files = 0;

  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return; // missing or unreadable — treat as empty
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        bytes += stat.size;
        if (stat.nlink <= 1) unique += stat.size;
        files += 1;
      } catch {
        /* vanished mid-walk */
      }
    }
  };

  walk(dir);
  return { bytes, unique, files };
}

function diskSpace() {
  try {
    const stat = fs.statfsSync(DATA_DIR);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    return { total, free, used: total - free };
  } catch {
    // statfs isn't available on every platform/Node build — the rest of the
    // report is still useful without it.
    return null;
  }
}

export function buildStorageReport({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.computedAtMs < CACHE_MS) return cache.report;

  const originals = measure(ORIGINALS_DIR);
  const derived = measure(DERIVED_DIR);
  const backups = measure(backupRoot());

  let databaseBytes = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      databaseBytes += fs.statSync(`${DB_PATH}${suffix}`).size;
    } catch {
      /* wal/shm may not exist */
    }
  }

  // Per-person totals come from the photos table, no disk walk needed.
  const byUser = db
    .prepare(
      `SELECT COALESCE(u.name, 'Added on the frame') AS name,
              COUNT(*) AS count,
              COALESCE(SUM(p.bytes), 0) AS bytes
       FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       GROUP BY p.uploaded_by
       ORDER BY bytes DESC`
    )
    .all();

  const largest = db
    .prepare(
      `SELECT p.id, p.original_name, p.bytes, p.created_at, u.name AS uploaded_by_name
       FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.bytes IS NOT NULL
       ORDER BY p.bytes DESC LIMIT 5`
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.original_name,
      bytes: row.bytes,
      addedBy: row.uploaded_by_name,
      addedAt: row.created_at,
    }));

  const counts = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM photos GROUP BY status`
    )
    .all()
    .reduce((acc, row) => ({ ...acc, [row.status]: row.n }), {});

  const report = {
    computedAt: new Date().toISOString(),
    disk: diskSpace(),
    photos: {
      originals: originals.bytes,
      files: originals.files,
      derived: derived.bytes,
      derivedFiles: derived.files,
      counts,
    },
    database: databaseBytes,
    backups: {
      // `bytes` is what the folders look like; `unique` is what deleting them
      // would actually free, since photos are hardlinked to the originals.
      bytes: backups.bytes,
      unique: backups.unique,
      files: backups.files,
    },
    byUser: byUser.map((row) => ({ name: row.name, count: row.count, bytes: row.bytes })),
    largest,
  };

  cache = { computedAtMs: Date.now(), report };
  return report;
}

/**
 * Deletes the resized copies. They're regenerated on demand from the
 * originals, so this is always safe — the first slide after clearing is just a
 * little slower.
 */
export function clearDerivedCache() {
  const before = measure(DERIVED_DIR);
  let removed = 0;
  try {
    for (const name of fs.readdirSync(DERIVED_DIR)) {
      try {
        fs.rmSync(path.join(DERIVED_DIR, name), { force: true });
        removed += 1;
      } catch {
        /* in use — skip */
      }
    }
  } catch {
    /* nothing to clear */
  }
  cache = null;
  return { removed, freed: before.bytes };
}
