import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDataDir, startTestServer, createAdmin } from './helpers.js';

const dataDir = useTempDataDir();

let harness;
let admin;
let backup;

before(async () => {
  harness = await startTestServer();
  admin = await createAdmin(harness);
  backup = await import('../src/services/backup.js');

  // A couple of fake originals so there's something to link.
  const originals = path.join(dataDir, 'originals');
  fs.mkdirSync(originals, { recursive: true });
  fs.writeFileSync(path.join(originals, 'a.jpg'), 'photo-a-contents');
  fs.writeFileSync(path.join(originals, 'b.jpg'), 'photo-b-contents');
});

after(async () => {
  await harness.close();
});

describe('backups', () => {
  it('writes a database snapshot and the photos', async () => {
    const result = await backup.runBackup();
    assert.equal(result.ok, true);
    assert.equal(result.photos, 2);
    assert.ok(fs.existsSync(path.join(result.path, 'frame.db')));
    assert.ok(fs.existsSync(path.join(result.path, 'originals', 'a.jpg')));
    assert.ok(fs.existsSync(path.join(result.path, 'manifest.json')));
  });

  it('produces a database that actually opens', async () => {
    const result = await backup.runBackup();
    const Database = (await import('better-sqlite3')).default;
    const restored = new Database(path.join(result.path, 'frame.db'), { readonly: true });
    const users = restored.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    restored.close();
    assert.equal(users, 1, 'the admin should be in the snapshot');
  });

  it('hardlinks photos so generations are nearly free', async () => {
    const result = await backup.runBackup();
    const source = fs.statSync(path.join(dataDir, 'originals', 'a.jpg'));
    const copy = fs.statSync(path.join(result.path, 'originals', 'a.jpg'));
    // Same inode == the file is shared, not duplicated.
    assert.equal(copy.ino, source.ino);
  });

  it('does not let two runs in the same minute collide', async () => {
    const before = backup.listBackups().backups.length;
    await backup.runBackup();
    await backup.runBackup();
    const after = backup.listBackups().backups.length;
    assert.equal(after, before + 2, 'each run should be its own generation');
  });

  it('prunes to the configured number of generations', async () => {
    const { setSetting } = await import('../src/db.js');
    setSetting('backup_keep', '2');
    await backup.runBackup();
    assert.equal(backup.listBackups().backups.length, 2);
    setSetting('backup_keep', '7');
  });

  it('reports an unwritable destination instead of throwing', async () => {
    const { setSetting } = await import('../src/db.js');
    setSetting('backup_path', path.join(dataDir, 'originals', 'a.jpg', 'nope'));
    const result = await backup.runBackup();
    assert.equal(result.ok, false);
    assert.ok(result.error);
    setSetting('backup_path', '');
  });

  it('refuses a path-traversing download name', async () => {
    const res = await admin.get('/backups/..%2F..%2Fetc/database');
    assert.ok(res.status === 400 || res.status === 404);
  });
});

describe('health report', () => {
  it('flags a failing calendar feed', async () => {
    const { db, newId, nowIso } = await import('../src/db.js');
    db.prepare(
      `INSERT INTO feeds (id, name, url, color, enabled, last_error, created_at)
       VALUES (?, 'Broken', 'https://example.invalid/f.ics', '#fff', 1, 'HTTP 404 Not Found', ?)`
    ).run(newId(), nowIso());

    const { buildHealthReport } = await import('../src/services/health.js');
    const report = buildHealthReport();
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((i) => i.area === 'calendar' && i.level === 'error'));
  });

  it('counts photos, events and displays', async () => {
    const { buildHealthReport } = await import('../src/services/health.js');
    const report = buildHealthReport();
    assert.equal(typeof report.stats.photos, 'number');
    assert.equal(typeof report.stats.displays, 'number');
    assert.ok(report.stats.lastBackupAt, 'should know about the backups made above');
  });
});
