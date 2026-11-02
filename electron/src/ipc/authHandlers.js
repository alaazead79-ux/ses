const { handleSafely } = require('./handleSafely');

function registerAuthHandlers(ipcMain, auth) {
  handleSafely(ipcMain, 'auth:state', () => ({ needsSetup: auth.needsSetup() }));
  handleSafely(ipcMain, 'auth:setupOwner', (key, input) => auth.setupOwner(key, input));
  handleSafely(ipcMain, 'auth:login', (key, input) => auth.login(key, input));
  handleSafely(ipcMain, 'auth:logout', (key) => auth.logout(key));
  handleSafely(ipcMain, 'auth:changePassword', (key, input) => auth.changeOwnPassword(key, input));
  handleSafely(ipcMain, 'auth:currentUser', (key) => auth.currentUser(key));

  handleSafely(ipcMain, 'users:list', (key) => auth.listUsers(key));
  handleSafely(ipcMain, 'users:permissions', (key) => auth.listPermissions(key));
  handleSafely(ipcMain, 'users:create', (key, input) => auth.createUser(key, input));
  handleSafely(ipcMain, 'users:update', (key, input) => auth.updateUser(key, input?.id, input?.changes));
}

module.exports = { registerAuthHandlers };
