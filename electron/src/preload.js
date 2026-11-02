const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
  dbStatus: () => invoke('db:status'),
  backupCreate: () => invoke('backup:create'),
  auth: {
    state: () => invoke('auth:state'),
    setupOwner: (input) => invoke('auth:setupOwner', input),
    login: (input) => invoke('auth:login', input),
    logout: () => invoke('auth:logout'),
    changePassword: (input) => invoke('auth:changePassword', input),
    currentUser: () => invoke('auth:currentUser'),
  },
  users: {
    list: () => invoke('users:list'),
    permissions: () => invoke('users:permissions'),
    create: (input) => invoke('users:create', input),
    update: (id, changes) => invoke('users:update', { id, changes }),
  },
});
