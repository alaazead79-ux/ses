const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./passwords');
const { ROLE_PERMISSIONS } = require('./rolePermissions');
const { UserFacingError } = require('../errors');
const { audit: writeAudit, nowIso } = require('../domain/audit');

const ASSIGNABLE_ROLES = ['manager', 'accountant', 'user'];
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_BASE_LOCK_MS = 30 * 1000;
const LOGIN_MAX_LOCK_MS = 15 * 60 * 1000;
const INVALID_CREDENTIALS = 'اسم المستخدم أو كلمة المرور غير صحيحة';
const INACTIVE_ACCOUNT = 'هذا الحساب معطّل. تواصل مع المالك';

const USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.password_hash, u.role_id, u.is_active, u.created_at, r.label AS role_label
  FROM users u JOIN roles r ON r.id = u.role_id`;

function validateUsername(value) {
  const username = String(value ?? '').trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new UserFacingError('اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا: أحرف إنجليزية أو أرقام أو . _ -');
  }
  return username;
}

function validateDisplayName(value) {
  const name = String(value ?? '').trim();
  if (name.length === 0 || name.length > 80) {
    throw new UserFacingError('الاسم الظاهر مطلوب ولا يتجاوز 80 حرفًا');
  }
  return name;
}

function validatePassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new UserFacingError(`كلمة المرور يجب أن تكون بين ${MIN_PASSWORD_LENGTH} و${MAX_PASSWORD_LENGTH} حرفًا`);
  }
  return password;
}

function validateAssignableRole(value) {
  if (!ASSIGNABLE_ROLES.includes(value)) {
    throw new UserFacingError('الدور المختار غير صالح');
  }
  return value;
}

function lockMessage(retryAfterSeconds) {
  if (retryAfterSeconds < 60) {
    return `تم إيقاف تسجيل الدخول مؤقتًا بسبب محاولات متكررة. حاول بعد ${retryAfterSeconds} ثانية`;
  }
  return `تم إيقاف تسجيل الدخول مؤقتًا بسبب محاولات متكررة. حاول بعد ${Math.ceil(retryAfterSeconds / 60)} دقيقة`;
}

function createAuthService(db, { clock = () => Date.now() } = {}) {
  const sessions = new Map();

  const allPermissionIds = () => db.prepare('SELECT id FROM permissions').all().map((row) => row.id);

  const knownPermissionIds = () => new Set(allPermissionIds());

  function validatePermissionIds(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new UserFacingError('قائمة الصلاحيات غير صالحة');
    const known = knownPermissionIds();
    const unique = [...new Set(value)];
    for (const id of unique) {
      if (typeof id !== 'string' || !known.has(id)) throw new UserFacingError('توجد صلاحية غير معروفة في القائمة');
    }
    return unique;
  }

  function effectivePermissions(userRow) {
    if (userRow.role_id === 'owner') return allPermissionIds();
    const explicit = db
      .prepare('SELECT permission_id FROM user_permissions WHERE user_id = ?')
      .all(userRow.id)
      .map((row) => row.permission_id);
    return [...new Set([...(ROLE_PERMISSIONS[userRow.role_id] ?? []), ...explicit])];
  }

  function toPublicUser(row) {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      roleId: row.role_id,
      roleLabel: row.role_label,
      permissions: effectivePermissions(row),
    };
  }

  function findUserById(id) {
    return db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id);
  }

  function findUserByUsername(username) {
    return db.prepare(`${USER_SELECT} WHERE u.username = ?`).get(username);
  }

  function countUsers() {
    return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  }

  function audit({ userId, action, module, entityId, details }) {
    writeAudit(db, { userId, action, module, entityId, entityType: 'user', details });
  }

  function activeUserForSession(sessionKey) {
    const userId = sessions.get(sessionKey);
    if (!userId) return null;
    const row = findUserById(userId);
    if (!row || row.is_active !== 1) {
      sessions.delete(sessionKey);
      return null;
    }
    return row;
  }

  function requireUser(sessionKey) {
    const row = activeUserForSession(sessionKey);
    if (!row) throw new UserFacingError('يجب تسجيل الدخول أولًا');
    return row;
  }

  function requirePermission(sessionKey, permission) {
    const row = requireUser(sessionKey);
    if (!effectivePermissions(row).includes(permission)) {
      throw new UserFacingError('ليست لديك صلاحية لتنفيذ هذه العملية');
    }
    return row;
  }

  function endSessionsForUser(userId, keepSessionKey = null) {
    for (const [key, id] of sessions) {
      if (id === userId && key !== keepSessionKey) sessions.delete(key);
    }
  }

  function assertCanGrant(actor, permissionIds) {
    const actorPermissions = new Set(effectivePermissions(actor));
    for (const id of permissionIds) {
      if (!actorPermissions.has(id)) {
        throw new UserFacingError('لا يمكنك منح صلاحية لا تملكها');
      }
    }
  }

  function needsSetup() {
    return countUsers() === 0;
  }

  function limiterKey(username) {
    return username.toLowerCase().slice(0, 64);
  }

  function lockStatus(key) {
    const current = clock();
    const failures = db.prepare(`
      SELECT attempted_at FROM login_attempts
      WHERE username_key = ? AND succeeded = 0 AND attempted_at >= ?
      ORDER BY attempted_at DESC
    `).all(key, current - LOGIN_WINDOW_MS);
    if (failures.length < LOGIN_MAX_FAILURES) return null;
    const lockMs = Math.min(LOGIN_MAX_LOCK_MS, LOGIN_BASE_LOCK_MS * 2 ** (failures.length - LOGIN_MAX_FAILURES));
    const unlockAt = failures[0].attempted_at + lockMs;
    return unlockAt > current ? Math.ceil((unlockAt - current) / 1000) : null;
  }

  function recordAttempt(key, succeeded) {
    const current = clock();
    db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').run(current - LOGIN_WINDOW_MS);
    db.prepare('INSERT INTO login_attempts (username_key, succeeded, attempted_at) VALUES (?, ?, ?)')
      .run(key, succeeded ? 1 : 0, current);
  }

  function clearAttempts(key) {
    db.prepare('DELETE FROM login_attempts WHERE username_key = ?').run(key);
  }

  async function setupOwner(sessionKey, input) {
    const username = validateUsername(input?.username);
    const displayName = validateDisplayName(input?.displayName);
    const password = validatePassword(input?.password);
    const passwordHash = await hashPassword(password);
    const ownerId = crypto.randomUUID();
    const now = nowIso();

    db.transaction(() => {
      if (countUsers() > 0) throw new UserFacingError('تم إعداد حساب المالك مسبقًا');
      db.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, role_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'owner', 1, ?, ?)
      `).run(ownerId, username, displayName, passwordHash, now, now);
      audit({ userId: ownerId, action: 'setup_owner', module: 'auth', entityId: ownerId, details: { username } });
    })();

    sessions.set(sessionKey, ownerId);
    return toPublicUser(findUserById(ownerId));
  }

  async function login(sessionKey, input) {
    const username = String(input?.username ?? '').trim();
    const password = typeof input?.password === 'string' ? input.password : '';
    const key = limiterKey(username);

    const retryAfterSeconds = lockStatus(key);
    if (retryAfterSeconds !== null) {
      audit({ userId: null, action: 'login_blocked', module: 'auth', details: { username } });
      throw new UserFacingError(lockMessage(retryAfterSeconds));
    }

    const row = username ? findUserByUsername(username) : undefined;
    const valid = row ? await verifyPassword(password, row.password_hash) : false;

    if (!row || !valid) {
      recordAttempt(key, false);
      audit({ userId: row?.id ?? null, action: 'login_failed', module: 'auth', details: { username } });
      throw new UserFacingError(INVALID_CREDENTIALS);
    }
    if (row.is_active !== 1) throw new UserFacingError(INACTIVE_ACCOUNT);

    clearAttempts(key);
    sessions.set(sessionKey, row.id);
    audit({ userId: row.id, action: 'login', module: 'auth' });
    return toPublicUser(row);
  }

  async function changeOwnPassword(sessionKey, input) {
    const row = requireUser(sessionKey);
    const currentPassword = typeof input?.currentPassword === 'string' ? input.currentPassword : '';
    const newPassword = validatePassword(input?.newPassword);
    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      throw new UserFacingError('كلمة المرور الحالية غير صحيحة');
    }
    if (currentPassword === newPassword) {
      throw new UserFacingError('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
    }
    const passwordHash = await hashPassword(newPassword);

    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, nowIso(), row.id);
      audit({ userId: row.id, action: 'change_password', module: 'auth', entityId: row.id });
    })();

    endSessionsForUser(row.id, sessionKey);
  }

  function logout(sessionKey) {
    const userId = sessions.get(sessionKey);
    sessions.delete(sessionKey);
    if (userId) audit({ userId, action: 'logout', module: 'auth' });
  }

  function currentUser(sessionKey) {
    const row = activeUserForSession(sessionKey);
    return row ? toPublicUser(row) : null;
  }

  function listUsers(sessionKey) {
    requirePermission(sessionKey, 'users.manage');
    return db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role_id, r.label AS role_label, u.is_active, u.created_at
      FROM users u JOIN roles r ON r.id = u.role_id
      ORDER BY u.created_at
    `).all().map((row) => ({ ...row, is_active: row.is_active === 1 }));
  }

  function listPermissions(sessionKey) {
    requirePermission(sessionKey, 'users.manage');
    return db.prepare('SELECT id, label FROM permissions ORDER BY id').all();
  }

  async function createUser(sessionKey, input) {
    const actor = requirePermission(sessionKey, 'users.manage');
    const username = validateUsername(input?.username);
    const displayName = validateDisplayName(input?.displayName);
    const password = validatePassword(input?.password);
    const roleId = validateAssignableRole(input?.roleId);
    const permissions = validatePermissionIds(input?.permissions);
    assertCanGrant(actor, permissions);
    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();
    const now = nowIso();

    db.transaction(() => {
      if (findUserByUsername(username)) throw new UserFacingError('اسم المستخدم مستخدم بالفعل');
      db.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, role_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, username, displayName, passwordHash, roleId, now, now);
      const grant = db.prepare('INSERT INTO user_permissions (user_id, permission_id) VALUES (?, ?)');
      for (const permissionId of permissions) grant.run(id, permissionId);
      audit({ userId: actor.id, action: 'create', module: 'users', entityId: id, details: { username, roleId } });
    })();
  }

  async function updateUser(sessionKey, id, changes) {
    const actor = requirePermission(sessionKey, 'users.manage');
    const target = findUserById(String(id ?? ''));
    if (!target) throw new UserFacingError('المستخدم غير موجود');
    const edit = changes ?? {};
    const isTargetOwner = target.role_id === 'owner';

    if (isTargetOwner && actor.role_id !== 'owner') {
      throw new UserFacingError('لا يمكن تعديل حساب المالك');
    }

    const next = {
      display_name: target.display_name,
      role_id: target.role_id,
      is_active: target.is_active,
      password_hash: target.password_hash,
    };
    const changed = [];

    if (edit.displayName !== undefined) {
      next.display_name = validateDisplayName(edit.displayName);
      changed.push('displayName');
    }
    if (edit.roleId !== undefined) {
      if (isTargetOwner) throw new UserFacingError('لا يمكن تغيير دور المالك');
      next.role_id = validateAssignableRole(edit.roleId);
      changed.push('roleId');
    }
    if (edit.isActive !== undefined) {
      if (isTargetOwner && !edit.isActive) throw new UserFacingError('لا يمكن تعطيل حساب المالك');
      if (target.id === actor.id && !edit.isActive) throw new UserFacingError('لا يمكنك تعطيل حسابك الحالي');
      next.is_active = edit.isActive ? 1 : 0;
      changed.push('isActive');
    }
    if (edit.password) {
      next.password_hash = await hashPassword(validatePassword(edit.password));
      changed.push('password');
    }
    let permissions = null;
    if (edit.permissions !== undefined) {
      if (isTargetOwner) throw new UserFacingError('صلاحيات المالك ثابتة ولا تُعدّل');
      permissions = validatePermissionIds(edit.permissions);
      assertCanGrant(actor, permissions);
      changed.push('permissions');
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE users SET display_name = ?, role_id = ?, is_active = ?, password_hash = ?, updated_at = ?
        WHERE id = ?
      `).run(next.display_name, next.role_id, next.is_active, next.password_hash, nowIso(), target.id);
      if (permissions !== null) {
        db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(target.id);
        const grant = db.prepare('INSERT INTO user_permissions (user_id, permission_id) VALUES (?, ?)');
        for (const permissionId of permissions) grant.run(target.id, permissionId);
      }
      audit({ userId: actor.id, action: 'update', module: 'users', entityId: target.id, details: { changed } });
    })();

    if (next.is_active === 0 || changed.includes('password')) endSessionsForUser(target.id);
  }

  return {
    needsSetup,
    setupOwner,
    login,
    logout,
    changeOwnPassword,
    currentUser,
    requireUser,
    requirePermission,
    listUsers,
    listPermissions,
    createUser,
    updateUser,
  };
}

module.exports = { createAuthService };
