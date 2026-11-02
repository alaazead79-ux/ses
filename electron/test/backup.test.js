const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase, createBackup } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const treasury = require('../src/services/treasuryService');
const backups = require('../src/services/backupService');

let tmpDir;
let opened;
let userId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-backup-'));
  opened = openDatabase(tmpDir);
  const owner = await createAuthService(opened.db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
});

afterEach(() => {
  try { opened.db.close(); } catch { /* already closed by restore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const cashboxCount = (db) => db.prepare('SELECT COUNT(*) AS c FROM cashboxes').get().c;

test('restoring a backup brings back the earlier data and keeps a safety copy', async () => {
  const before = cashboxCount(opened.db);
  treasury.createCashbox(opened.db, userId, { name: 'الأولى', openingBalance: 1000, date: '2024-01-01' });
  const backupPath = await createBackup(opened.db, opened.backupDir);
  treasury.createCashbox(opened.db, userId, { name: 'الثانية', openingBalance: 2000, date: '2024-01-02' });
  assert.equal(cashboxCount(opened.db), before + 2);

  const { safetyBackup } = await backups.restoreBackup(opened.db, {
    liveFilePath: opened.filePath, backupDir: opened.backupDir, backupFilePath: backupPath,
  });
  assert.ok(fs.existsSync(safetyBackup));

  const reopened = openDatabase(tmpDir);
  opened.db = reopened.db;
  assert.equal(cashboxCount(reopened.db), before + 1);
  assert.equal(backups.listBackups(opened.backupDir).length, 2);
});

test('a corrupt backup is refused and the live database stays open and unchanged', async () => {
  const bad = path.join(opened.backupDir, 'farm-backup-bad.db');
  fs.writeFileSync(bad, 'not a sqlite file');
  const before = cashboxCount(opened.db);
  await assert.rejects(backups.restoreBackup(opened.db, {
    liveFilePath: opened.filePath, backupDir: opened.backupDir, backupFilePath: bad,
  }), UserFacingError);
  assert.equal(opened.db.open, true);
  assert.equal(cashboxCount(opened.db), before);
});

test('a file outside the backup folder is refused', async () => {
  const outside = path.join(tmpDir, 'farm-backup-x.db');
  fs.writeFileSync(outside, '');
  await assert.rejects(backups.restoreBackup(opened.db, {
    liveFilePath: opened.filePath, backupDir: opened.backupDir, backupFilePath: outside,
  }), UserFacingError);
});
