import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

/** Everything mutable lives under data/ so the whole state is one folder to back up. */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(SERVER_ROOT, 'data');

export const DB_PATH = path.join(DATA_DIR, 'frame.db');
export const ORIGINALS_DIR = path.join(DATA_DIR, 'originals');
export const DERIVED_DIR = path.join(DATA_DIR, 'derived');
export const SECRET_PATH = path.join(DATA_DIR, 'jwt-secret');

export const WEB_DIST = path.join(REPO_ROOT, 'web', 'dist');

export function ensureDirs() {
  for (const dir of [DATA_DIR, ORIGINALS_DIR, DERIVED_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
