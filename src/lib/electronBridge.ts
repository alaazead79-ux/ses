export interface DesktopAuthUser {
  id: string;
  username: string;
  displayName: string;
  roleId: string;
  roleLabel: string;
  permissions: string[];
}

export interface UserListResult {
  id: string;
  username: string;
  display_name: string;
  role_id: string;
  role_label: string;
  is_active: boolean;
  created_at: string;
}

export interface PermissionOption {
  id: string;
  label: string;
}

export interface SetupOwnerInput {
  username: string;
  displayName: string;
  password: string;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  password: string;
  roleId: string;
  permissions: string[];
}

export interface UpdateUserChanges {
  displayName?: string;
  roleId?: string;
  isActive?: boolean;
  password?: string;
  permissions?: string[];
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface DesktopApi {
  platform: string;
  versions: { electron: string; node: string };
  dbStatus: () => Promise<{ path: string; schemaVersion: string | null }>;
  backupCreate: () => Promise<{ path: string }>;
  auth: {
    state: () => Promise<{ needsSetup: boolean }>;
    setupOwner: (input: SetupOwnerInput) => Promise<DesktopAuthUser>;
    login: (input: { username: string; password: string }) => Promise<DesktopAuthUser>;
    logout: () => Promise<void>;
    changePassword: (input: ChangePasswordInput) => Promise<void>;
    currentUser: () => Promise<DesktopAuthUser | null>;
  };
  users: {
    list: () => Promise<UserListResult[]>;
    permissions: () => Promise<PermissionOption[]>;
    create: (input: CreateUserInput) => Promise<void>;
    update: (id: string, changes: UpdateUserChanges) => Promise<void>;
  };
}

declare global {
  interface Window {
    electronAPI?: DesktopApi;
  }
}

export function getDesktopApi(): DesktopApi | null {
  return window.electronAPI ?? null;
}
