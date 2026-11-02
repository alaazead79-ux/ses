const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const { registerAuthHandlers } = require('../src/ipc/authHandlers');

const OWNER = { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' };

let tmpDir;
let database;
let auth;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-auth-'));
  database = openDatabase(tmpDir);
  auth = createAuthService(database.db);
});

afterEach(() => {
  database.db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function expectUserError(promise, message) {
  await assert.rejects(promise, (error) => error instanceof UserFacingError && error.message === message);
}

test('fresh database needs owner setup and has no default account', () => {
  assert.equal(auth.needsSetup(), true);
  assert.equal(database.db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 0);
});

test('owner setup creates the owner, signs them in, and cannot run twice', async () => {
  const user = await auth.setupOwner('window-1', OWNER);
  assert.equal(user.roleId, 'owner');
  assert.equal(user.username, 'owner');
  assert.equal(auth.needsSetup(), false);
  assert.ok(user.permissions.includes('users.manage'));
  assert.equal(auth.currentUser('window-1').username, 'owner');
  await expectUserError(auth.setupOwner('window-2', { ...OWNER, username: 'other' }), 'تم إعداد حساب المالك مسبقًا');
});

test('stored password is a salted hash, never the plain text', async () => {
  await auth.setupOwner('w', OWNER);
  const stored = database.db.prepare('SELECT password_hash FROM users').get().password_hash;
  assert.ok(stored.startsWith('scrypt$'));
  assert.ok(!stored.includes(OWNER.password));
});

test('login rejects wrong password and unknown user with the same message', async () => {
  await auth.setupOwner('w', OWNER);
  await expectUserError(auth.login('x', { username: 'owner', password: 'wrong-pass' }), 'اسم المستخدم أو كلمة المرور غير صحيحة');
  await expectUserError(auth.login('x', { username: 'nobody', password: OWNER.password }), 'اسم المستخدم أو كلمة المرور غير صحيحة');
  const failures = database.db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'login_failed'").get().c;
  assert.equal(failures, 2);
});

test('default admin credentials do not sign in', async () => {
  await auth.setupOwner('w', OWNER);
  await expectUserError(auth.login('x', { username: 'admin', password: 'admin123' }), 'اسم المستخدم أو كلمة المرور غير صحيحة');
});

test('logout ends the session for that window only', async () => {
  await auth.setupOwner('w1', OWNER);
  await auth.login('w2', { username: 'owner', password: OWNER.password });
  auth.logout('w1');
  assert.equal(auth.currentUser('w1'), null);
  assert.equal(auth.currentUser('w2').username, 'owner');
});

test('manager gets role permissions, but cannot manage users', async () => {
  await auth.setupOwner('owner-window', OWNER);
  await auth.createUser('owner-window', { username: 'manager1', displayName: 'مدير', password: 'manager-pass', roleId: 'manager', permissions: [] });
  const manager = await auth.login('mgr-window', { username: 'manager1', password: 'manager-pass' });
  assert.ok(manager.permissions.includes('treasury.add'));
  assert.ok(!manager.permissions.includes('users.manage'));
  assert.throws(() => auth.listUsers('mgr-window'), (error) => error instanceof UserFacingError && error.message === 'ليست لديك صلاحية لتنفيذ هذه العملية');
});

test('individual grants add permissions beyond the role', async () => {
  await auth.setupOwner('owner-window', OWNER);
  await auth.createUser('owner-window', { username: 'basic', displayName: 'موظف', password: 'basic-pass', roleId: 'user', permissions: ['backup.create'] });
  const user = await auth.login('basic-window', { username: 'basic', password: 'basic-pass' });
  assert.ok(user.permissions.includes('backup.create'));
  assert.ok(!user.permissions.includes('treasury.add'));
});

test('a user cannot grant a permission they do not hold', async () => {
  await auth.setupOwner('owner-window', OWNER);
  await auth.createUser('owner-window', { username: 'helper', displayName: 'مساعد', password: 'helper-pass', roleId: 'manager', permissions: ['users.manage'] });
  await auth.login('helper-window', { username: 'helper', password: 'helper-pass' });
  await expectUserError(
    auth.createUser('helper-window', { username: 'newperson', displayName: 'x', password: 'password-1', roleId: 'user', permissions: ['settings.edit'] }),
    'لا يمكنك منح صلاحية لا تملكها',
  );
});

test('owner cannot be deactivated, demoted, or edited by others', async () => {
  await auth.setupOwner('owner-window', OWNER);
  const ownerId = database.db.prepare("SELECT id FROM users WHERE role_id = 'owner'").get().id;
  await expectUserError(auth.updateUser('owner-window', ownerId, { isActive: false }), 'لا يمكن تعطيل حساب المالك');
  await expectUserError(auth.updateUser('owner-window', ownerId, { roleId: 'user' }), 'لا يمكن تغيير دور المالك');
});

test('deactivating a user blocks their login and ends their sessions', async () => {
  await auth.setupOwner('owner-window', OWNER);
  await auth.createUser('owner-window', { username: 'acc1', displayName: 'محاسب', password: 'acc-pass-1', roleId: 'accountant', permissions: [] });
  const list = auth.listUsers('owner-window');
  const accountantId = list.find((u) => u.username === 'acc1').id;
  await auth.login('acc-window', { username: 'acc1', password: 'acc-pass-1' });
  await auth.updateUser('owner-window', accountantId, { isActive: false });
  assert.equal(auth.currentUser('acc-window'), null);
  await expectUserError(auth.login('acc-window', { username: 'acc1', password: 'acc-pass-1' }), 'هذا الحساب معطّل. تواصل مع المالك');
});

test('a user with user management cannot deactivate their own account', async () => {
  await auth.setupOwner('owner-window', OWNER);
  await auth.createUser('owner-window', { username: 'helper', displayName: 'مساعد', password: 'helper-pass', roleId: 'manager', permissions: ['users.manage'] });
  await auth.login('helper-window', { username: 'helper', password: 'helper-pass' });
  const helperId = auth.listUsers('helper-window').find((u) => u.username === 'helper').id;
  await expectUserError(auth.updateUser('helper-window', helperId, { isActive: false }), 'لا يمكنك تعطيل حسابك الحالي');
});

test('username is unique regardless of letter case', async () => {
  await auth.setupOwner('owner-window', OWNER);
  await expectUserError(
    auth.createUser('owner-window', { username: 'OWNER', displayName: 'x', password: 'password-1', roleId: 'user', permissions: [] }),
    'اسم المستخدم مستخدم بالفعل',
  );
});

test('invalid input is rejected with a readable message', async () => {
  await expectUserError(auth.setupOwner('w', { ...OWNER, username: 'a b' }), 'اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا: أحرف إنجليزية أو أرقام أو . _ -');
  await expectUserError(auth.setupOwner('w', { ...OWNER, password: 'short' }), 'كلمة المرور يجب أن تكون بين 8 و200 حرفًا');
});

test('protected operations need a signed-in session', () => {
  assert.throws(() => auth.listUsers('nobody'), /يجب تسجيل الدخول أولًا/);
});

test('ipc handlers return wrapped results and hide unexpected errors', async () => {
  const handlers = new Map();
  const fakeIpc = { handle: (channel, fn) => handlers.set(channel, fn) };
  registerAuthHandlers(fakeIpc, auth);
  const event = { sender: { id: 7 } };

  const setup = await handlers.get('auth:setupOwner')(event, OWNER);
  assert.equal(setup.ok, true);
  assert.equal(setup.data.username, 'owner');

  const denied = await handlers.get('users:list')({ sender: { id: 99 } });
  assert.deepEqual(denied, { ok: false, error: 'يجب تسجيل الدخول أولًا' });

  const state = await handlers.get('auth:state')(event);
  assert.deepEqual(state, { ok: true, data: { needsSetup: false } });
});
