import {
  getDesktopApi,
  type ChangePasswordInput,
  type CreateUserInput,
  type DesktopApi,
  type DesktopAuthUser,
  type PermissionOption,
  type SetupOwnerInput,
  type UpdateUserChanges,
  type UserListResult,
} from '@/lib/electronBridge';

export type { DesktopAuthUser as AuthResult, UserListResult, SetupOwnerInput, CreateUserInput, UpdateUserChanges, PermissionOption, ChangePasswordInput };

export const DESKTOP_ONLY_MESSAGE = 'تسجيل الدخول يعمل داخل برنامج سطح المكتب فقط';

export function isDesktopAvailable(): boolean {
  return getDesktopApi() !== null;
}

function desktop(): DesktopApi {
  const api = getDesktopApi();
  if (!api) throw new Error(DESKTOP_ONLY_MESSAGE);
  return api;
}

export function getAuthState() {
  return desktop().auth.state();
}

export function setupOwner(input: SetupOwnerInput): Promise<DesktopAuthUser> {
  return desktop().auth.setupOwner(input);
}

export function login(username: string, password: string): Promise<DesktopAuthUser> {
  return desktop().auth.login({ username, password });
}

export function logout(): Promise<void> {
  return desktop().auth.logout();
}

export function changePassword(input: ChangePasswordInput): Promise<void> {
  return desktop().auth.changePassword(input);
}

export function getCurrentUser(): Promise<DesktopAuthUser | null> {
  return desktop().auth.currentUser();
}

export function listUsers(): Promise<UserListResult[]> {
  return desktop().users.list();
}

export function createUser(data: CreateUserInput): Promise<void> {
  return desktop().users.create(data);
}

export function updateUser(id: string, data: UpdateUserChanges): Promise<void> {
  return desktop().users.update(id, data);
}

export function listAllPermissions(): Promise<PermissionOption[]> {
  return desktop().users.permissions();
}
