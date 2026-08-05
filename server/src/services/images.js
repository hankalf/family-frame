import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { DERIVED_DIR, ORIGINALS_DIR } from '../paths.js';

export const SIZES = {
  thumb: 480,
  display: 2200,
};

export const ACCEPTED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.avif', '.gif']);

export function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function parseExifDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Reads dimensions (orientation-corrected) and capture date. Never throws — a
 * photo with unreadable metadata is still a perfectly good photo.
 */
export async function readMetadata(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    // Orientations 5-8 mean the stored pixels are rotated 90°.
    const swapped = meta.orientation >= 5 && meta.orientation <= 8;
    const width = swapped ? meta.height : meta.width;
    const height = swapped ? meta.width : meta.height;

    let takenAt = null;
    if (meta.exif) {
      try {
        const exif = exifReader(meta.exif);
        takenAt =
          parseExifDate(exif?.Photo?.DateTimeOriginal) ??
          parseExifDate(exif?.Photo?.DateTimeDigitized) ??
          parseExifDate(exif?.Image?.DateTime);
      } catch {
        /* unreadable EXIF block */
      }
    }
    return { width: width ?? null, height: height ?? null, takenAt };
  } catch {
    return { width: null, height: null, takenAt: null };
  }
}

function derivedPath(photoId, size) {
  return path.join(DERIVED_DIR, `${photoId}-${size}.jpg`);
}

/**
 * Returns a path to a resized JPEG, generating it on first request. Originals
 * are never served directly — a 12MP phone upload would stall the frame.
 */
export async function getDerivative(photo, size) {
  const key = SIZES[size] ? size : 'display';
  const target = derivedPath(photo.id, key);
  if (fs.existsSync(target)) return target;

  const source = path.join(ORIGINALS_DIR, photo.filename);
  if (!fs.existsSync(source)) return null;

  await sharp(source, { animated: false })
    .rotate() // honour EXIF orientation
    .resize({ width: SIZES[key], height: SIZES[key], fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: key === 'thumb' ? 72 : 86, mozjpeg: true })
    .toFile(target);

  return target;
}

export function deleteDerivatives(photoId) {
  for (const size of Object.keys(SIZES)) {
    const file = derivedPath(photoId, size);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
}

/** Warms the display-size cache in the background so the frame never waits. */
export function pregenerate(photo) {
  Promise.all([getDerivative(photo, 'thumb'), getDerivative(photo, 'display')]).catch((err) =>
    console.error(`[images] pregenerate failed for ${photo.id}:`, err.message)
  );
}
