const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');

const PASSWORD = 'owner-pass-1';
const INVALID = 'اسم المستخدم أو كلمة المرور غير صحيحة';
const LOCKED_PREFIX = 'تم إيقاف تسجيل الدخول مؤقتًا';

let tmpDir;
let database;
let auth;
let now;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-login-'));
  database = openDatabase(tmpDir);
  now = Date.parse('2025-01-01T10:00:00Z');
  auth = createAuthService(database.db, { clock: () => now });
  await auth.setupOwner('setup', { username: 'owner', displayName: 'المالك', password: PASSWORD });
  auth.logout('setup');
});

afterEach(() => {
  database.db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function attempt(username, password, key = 'window-x') {
  try {
    await auth.login(key, { username, password });
    return { ok: true };
  } catch (error) {
    assert.ok(error instanceof UserFacingError, 'login errors must be user-facing');
    return { ok: false, message: error.message };
  }
}

async function failTimes(count, username = 'owner') {
  for (let i = 0; i < count; i += 1) await attempt(username, 'wrong-pass-x');
}

function auditCount(action) {
  return database.db.prepare('SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?').get(action).c;
}

test('four wrong passwords still allow a correct sign-in', async () => {
  await failTimes(4);
  assert.deepEqual(await attempt('owner', PASSWORD), { ok: true });
});

test('fifth wrong password returns the generic message and the next attempt is locked', async () => {
  await failTimes(4);
  assert.deepEqual(await attempt('owner', 'wrong-pass-x'), { ok: false, message: INVALID });
  const locked = await attempt('owner', PASSWORD);
  assert.equal(locked.ok, false);
  assert.ok(locked.message.startsWith(LOCKED_PREFIX), 'correct password is refused while locked');
  assert.match(locked.message, /30 ثانية/);
});

test('lockout message is the same for unknown and existing usernames, so existence is not revealed', async () => {
  await failTimes(5, 'nobody-here');
  await failTimes(5, 'owner');
  const unknownLocked = await attempt('nobody-here', 'anything-x');
  const knownLocked = await attempt('owner', 'anything-x');
  assert.ok(unknownLocked.message.startsWith(LOCKED_PREFIX));
  assert.ok(knownLocked.message.startsWith(LOCKED_PREFIX));
  assert.equal(unknownLocked.message, knownLocked.message);
});

test('unknown username and wrong password give identical messages before lockout', async () => {
  const unknown = await attempt('nobody-here', 'anything-x');
  const wrong = await attempt('owner', 'anything-x');
  assert.deepEqual(unknown, wrong);
  assert.equal(unknown.message, INVALID);
});

test('lockout grows progressively after each further failure', async () => {
  await failTimes(5);
  now += 30_000;
  await failTimes(1);
  const lock = await attempt('owner', PASSWORD);
  assert.match(lock.message, /دقيقة/);

  now += 59_000;
  assert.ok((await attempt('owner', PASSWORD)).message.startsWith(LOCKED_PREFIX));
  now += 2_000;
  assert.deepEqual(await attempt('owner', PASSWORD), { ok: true });
});

test('account recovers after the lock expires and a correct password succeeds', async () => {
  await failTimes(5);
  now += 30_000;
  assert.deepEqual(await attempt('owner', PASSWORD), { ok: true });
  assert.equal(auth.currentUser('window-x').username, 'owner');
});

test('a successful sign-in clears the failure count', async () => {
  await failTimes(4);
  assert.deepEqual(await attempt('owner', PASSWORD), { ok: true });
  await failTimes(4);
  assert.deepEqual(await attempt('owner', PASSWORD), { ok: true });
});

test('failures outside the fifteen-minute window do not count', async () => {
  await failTimes(4);
  now += 16 * 60 * 1000;
  await failTimes(4);
  assert.deepEqual(await attempt('owner', PASSWORD), { ok: true });
});

test('blocked attempts are audited without storing the password', async () => {
  await failTimes(5);
  await attempt('owner', 'secret-typed-value');
  assert.equal(auditCount('login_blocked'), 1);
  const rows = database.db.prepare("SELECT details FROM audit_logs WHERE action LIKE 'login%'").all();
  for (const row of rows) assert.ok(!String(row.details).includes('secret-typed-value'));
});

test('failed attempts are logged as login_failed', async () => {
  await failTimes(2);
  assert.equal(auditCount('login_failed'), 2);
});

test('changing password requires the current password', async () => {
  await auth.login('w1', { username: 'owner', password: PASSWORD });
  await assert.rejects(
    auth.changeOwnPassword('w1', { currentPassword: 'not-right-x', newPassword: 'brand-new-pass' }),
    (error) => error instanceof UserFacingError && error.message === 'كلمة المرور الحالية غير صحيحة',
  );
  assert.deepEqual(await attempt('owner', PASSWORD), { ok: true });
});

test('changing password rejects a new password equal to the current one', async () => {
  await auth.login('w1', { username: 'owner', password: PASSWORD });
  await assert.rejects(
    auth.changeOwnPassword('w1', { currentPassword: PASSWORD, newPassword: PASSWORD }),
    (error) => error instanceof UserFacingError,
  );
});

test('changing password rejects a short new password', async () => {
  await auth.login('w1', { username: 'owner', password: PASSWORD });
  await assert.rejects(
    auth.changeOwnPassword('w1', { currentPassword: PASSWORD, newPassword: 'short' }),
    (error) => error instanceof UserFacingError,
  );
});

test('password change swaps the credential, keeps this session, and ends other sessions', async () => {
  await auth.login('w1', { username: 'owner', password: PASSWORD });
  await auth.login('w2', { username: 'owner', password: PASSWORD });

  await auth.changeOwnPassword('w1', { currentPassword: PASSWORD, newPassword: 'brand-new-pass' });

  assert.equal(auth.currentUser('w1').username, 'owner');
  assert.equal(auth.currentUser('w2'), null);
  assert.equal((await attempt('owner', PASSWORD)).ok, false);
  assert.deepEqual(await attempt('owner', 'brand-new-pass'), { ok: true });
  assert.equal(auditCount('change_password'), 1);
});

test('password change requires an active session', async () => {
  await assert.rejects(
    auth.changeOwnPassword('no-session', { currentPassword: PASSWORD, newPassword: 'brand-new-pass' }),
    (error) => error instanceof UserFacingError,
  );
});
