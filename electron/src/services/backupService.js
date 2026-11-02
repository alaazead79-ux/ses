const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { UserFacingError } = require('../errors');
const { createBackup } = require('../db/database');

const BACKUP_NAME = /^farm-backup-.*\.db$/;
const INVALID_BACKUP = 'ملف النسخة الاحتياطية تالف أو غير متوافق';

function verifyBackupFile(filePath) {
  let backup;
  try {
    backup = new Database(filePath, { readonly: true, fileMustExist: true });
    const check = backup.pragma('integrity_check', { simple: true });
    const hasSchema = backup.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    ).get();
    if (check !== 'ok' || !hasSchema) throw new UserFacingError(INVALID_BACKUP);
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError(INVALID_BACKUP);
  } finally {
    backup?.close();
  }
}

function listBackups(backupDir) {
  return fs.readdirSync(backupDir)
    .filter((name) => BACKUP_NAME.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(backupDir, name));
      return { filename: name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// الاستعادة: نسخة أمان من الحالية أولًا، ثم استبدال الملف. على المستدعي إعادة فتح القاعدة بعدها
async function restoreBackup(db, { liveFilePath, backupDir, backupFilePath }) {
  if (path.dirname(backupFilePath) !== backupDir || !BACKUP_NAME.test(path.basename(backupFilePath))) {
    throw new UserFacingError('ملف النسخة الاحتياطية غير موجود');
  }
  verifyBackupFile(backupFilePath);
  const safetyBackup = await createBackup(db, backupDir);
  db.close();
  for (const suffix of ['-wal', '-shm']) fs.rmSync(liveFilePath + suffix, { force: true });
  const staging = `${liveFilePath}.restore-tmp`;
  fs.copyFileSync(backupFilePath, staging);
  fs.renameSync(staging, liveFilePath);
  return { safetyBackup };
}

module.exports = { verifyBackupFile, listBackups, restoreBackup };
