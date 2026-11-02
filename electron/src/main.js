const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { openDatabase, getSchemaVersion, createBackup } = require('./db/database');
const { createAuthService } = require('./auth/authService');
const { registerFarmHandlers } = require('./ipc/farmHandlers');
const { restoreBackup } = require('./services/backupService');
const { UserFacingError } = require('./errors');
const { registerAuthHandlers } = require('./ipc/authHandlers');
const { handleSafely } = require('./ipc/handleSafely');

let mainWindow = null;
let database = null;
let auth = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'نظام الحسابات والإدارة المالية للمزرعة',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function registerIpcHandlers() {
  registerAuthHandlers(ipcMain, auth);
  registerFarmHandlers(ipcMain, auth, () => database.db, () => database.backupDir);

  handleSafely(ipcMain, 'db:status', (key) => {
    auth.requireUser(key);
    return { path: database.filePath, schemaVersion: getSchemaVersion(database.db) };
  });

  handleSafely(ipcMain, 'backup:create', async (key) => {
    auth.requirePermission(key, 'backup.create');
    const backupPath = await createBackup(database.db, database.backupDir);
    return { path: backupPath };
  });

  handleSafely(ipcMain, 'backup:restore', async (key, payload) => {
    auth.requirePermission(key, 'backup.restore');
    if (typeof payload?.filename !== 'string' || payload.filename.length === 0) {
      throw new UserFacingError('اختر ملف النسخة الاحتياطية');
    }
    await restoreBackup(database.db, {
      liveFilePath: database.filePath,
      backupDir: database.backupDir,
      backupFilePath: path.join(database.backupDir, path.basename(payload.filename)),
    });
    app.relaunch();
    app.exit(0);
    return { restarting: true };
  });
}

app.whenReady().then(() => {
  try {
    database = openDatabase(app.getPath('userData'));
  } catch (error) {
    dialog.showErrorBox('تعذر فتح قاعدة البيانات', String(error && error.message ? error.message : error));
    app.quit();
    return;
  }
  auth = createAuthService(database.db);
  registerIpcHandlers();
  createWindow();
});

app.on('before-quit', () => {
  if (database) database.db.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && database) createWindow();
});
