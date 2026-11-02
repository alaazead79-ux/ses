const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

function nowIso() {
  return new Date().toISOString();
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id),
  );
  const markApplied = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => MIGRATION_FILE_PATTERN.test(file))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      markApplied.run(id, nowIso());
    })();
  }
}

function openDatabase(userDataDir) {
  const databaseDir = path.join(userDataDir, 'Database');
  const backupDir = path.join(userDataDir, 'Backups');
  fs.mkdirSync(databaseDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const filePath = path.join(databaseDir, 'farm.db');
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);

  return { db, filePath, backupDir };
}

function getSchemaVersion(db) {
  const row = db.prepare('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1').get();
  return row ? row.id : null;
}

async function createBackup(db, backupDir) {
  const stamp = nowIso().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `farm-backup-${stamp}.db`);
  await db.backup(target);
  return target;
}

module.exports = { openDatabase, getSchemaVersion, createBackup };
