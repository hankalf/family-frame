/**
 * Photo sources feed the frame. Each source is responsible for getting image
 * files into data/originals/ and rows into the `photos` table with its own
 * `source` tag; everything downstream (serving, shuffling, moderation) is shared.
 *
 * Implemented:
 *   upload  — family members posting from the companion app (photos.js route)
 *   folder  — a directory on disk, rescanned periodically
 *
 * Not implemented — see googlePhotos.js for why.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, newId, nowIso } from '../db.js';
import { ORIGINALS_DIR } from '../paths.js';
import { ACCEPTED, hashFile, readMetadata, pregenerate } from './images.js';

const MAX_SCAN_FILES = 5000;

function* walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, depth + 1);
    else if (entry.isFile() && ACCEPTED.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

/**
 * Imports new images from the configured folder. Files are copied into
 * data/originals/ rather than referenced in place, so the frame keeps working
 * if the source folder is a USB stick that gets unplugged.
 */
export async function scanPhotoFolder() {
  const folder = (getSetting('photo_folder_path') || '').trim();
  if (!folder) return { skipped: true, added: 0 };
  if (!fs.existsSync(folder)) {
    console.warn(`[folder] photo_folder_path does not exist: ${folder}`);
    return { skipped: true, added: 0, error: 'Folder not found' };
  }

  const existing = new Set(
    db.prepare('SELECT hash FROM photos WHERE hash IS NOT NULL').all().map((r) => r.hash)
  );

  let added = 0;
  let seen = 0;
  for (const file of walk(folder)) {
    if (++seen > MAX_SCAN_FILES) {
      console.warn(`[folder] stopped after ${MAX_SCAN_FILES} files`);
      break;
    }
    let hash;
    try {
      hash = hashFile(file);
    } catch {
      continue;
    }
    if (existing.has(hash)) continue;

    const id = newId();
    const ext = path.extname(file).toLowerCase();
    const filename = `${id}${ext}`;
    try {
      fs.copyFileSync(file, path.join(ORIGINALS_DIR, filename));
    } catch (err) {
      console.error(`[folder] copy failed for ${file}: ${err.message}`);
      continue;
    }

    const stat = fs.statSync(file);
    const meta = await readMetadata(path.join(ORIGINALS_DIR, filename));

    db.prepare(
      `INSERT INTO photos (id, filename, original_name, width, height, bytes, hash, taken_at,
                           source, source_ref, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'folder', ?, 'approved', ?)`
    ).run(
      id,
      filename,
      path.basename(file),
      meta.width,
      meta.height,
      stat.size,
      hash,
      meta.takenAt ?? stat.mtime.toISOString(),
      file,
      nowIso()
    );

    existing.add(hash);
    added += 1;
    pregenerate({ id, filename });
  }

  if (added) console.log(`[folder] imported ${added} photo(s) from ${folder}`);
  return { skipped: false, added };
}

let timer = null;

export function startFolderScanning() {
  const run = async () => {
    await scanPhotoFolder().catch((err) => console.error('[folder] scan failed', err));
    const minutes = Math.max(1, Number(getSetting('folder_scan_minutes')) || 30);
    timer = setTimeout(run, minutes * 60 * 1000);
    timer.unref?.();
  };
  timer = setTimeout(run, 5000);
  timer.unref?.();
}

export function stopFolderScanning() {
  if (timer) clearTimeout(timer);
  timer = null;
}
