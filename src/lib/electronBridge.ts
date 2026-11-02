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
  farm: {
    expenses: {
      categories: () => Promise<{ expense: ExpenseCategoryOption[]; income: ExpenseCategoryOption[] }>;
      list: (args?: DateRangeArgs) => Promise<unknown[]>;
      create: (input: Record<string, unknown>) => Promise<{ id: string; docNumber: string; amount: number }>;
    };
    incomes: {
      list: (args?: DateRangeArgs) => Promise<unknown[]>;
      create: (input: Record<string, unknown>) => Promise<{ id: string; docNumber: string; amount: number }>;
    };
    treasury: {
      cashboxes: () => Promise<unknown[]>;
      createCashbox: (input: Record<string, unknown>) => Promise<{ id: string }>;
      statement: (args: Record<string, unknown>) => Promise<unknown>;
      transfers: () => Promise<unknown[]>;
      createTransfer: (input: Record<string, unknown>) => Promise<unknown>;
      checks: () => Promise<unknown[]>;
      createCheck: (input: Record<string, unknown>) => Promise<unknown>;
    };
    employees: {
      list: () => Promise<unknown[]>;
      create: (input: Record<string, unknown>) => Promise<{ id: string }>;
      attendance: (args: { month: string }) => Promise<unknown[]>;
      recordAttendance: (input: Record<string, unknown>) => Promise<void>;
      advances: (args?: { employeeId?: string | null }) => Promise<unknown[]>;
      createAdvance: (input: Record<string, unknown>) => Promise<{ id: string; docNumber: string }>;
      salaries: (args: { month: string }) => Promise<unknown[]>;
      createSalary: (input: Record<string, unknown>) => Promise<{ id: string; docNumber: string; net: number; advanceDeduct: number }>;
      paySalary: (input: Record<string, unknown>) => Promise<{ id: string }>;
    };
    dashboard: {
      summary: (args: { asOf: string }) => Promise<DashboardSummary>;
    };
    backups: {
      list: () => Promise<{ filename: string; size: number; createdAt: string }[]>;
      restore: (filename: string) => Promise<{ restarting: boolean }>;
    };
  };
}

export interface ExpenseCategoryOption {
  id: string;
  name: string;
  account_id: string | null;
}

export interface DateRangeArgs {
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface DashboardSummary {
  asOf: string;
  cashOnHand: number;
  receivables: number;
  payables: number;
  stockValue: number;
  lowStockCount: number;
  monthProfit: number;
}

declare global {
  interface Window {
    electronAPI?: DesktopApi;
  }
}

export function getDesktopApi(): DesktopApi | null {
  return window.electronAPI ?? null;
}
