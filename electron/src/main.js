const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { openDatabase, getSchemaVersion, createBackup } = require('./db/database');
const { createAuthService } = require('./auth/authService');
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

  handleSafely(ipcMain, 'db:status', (key) => {
    auth.requireUser(key);
    return { path: database.filePath, schemaVersion: getSchemaVersion(database.db) };
  });

  handleSafely(ipcMain, 'backup:create', async (key) => {
    auth.requirePermission(key, 'backup.create');
    const backupPath = await createBackup(database.db, database.backupDir);
    return { path: backupPath };
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
