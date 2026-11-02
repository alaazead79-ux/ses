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
      cancel: (input: { expenseId: string; date: string }) => Promise<{ id: string; reversalEntryNumber: string }>;
    };
    incomes: {
      list: (args?: DateRangeArgs) => Promise<unknown[]>;
      create: (input: Record<string, unknown>) => Promise<{ id: string; docNumber: string; amount: number }>;
      cancel: (input: { incomeId: string; date: string }) => Promise<{ id: string; reversalEntryNumber: string }>;
    };
    parties: {
      list: (args?: { type?: string | null; search?: string }) => Promise<DesktopPartyRow[]>;
      create: (input: DesktopPartyInput) => Promise<{ id: string }>;
      statement: (args: { partyId: string; dateFrom?: string | null; dateTo?: string | null }) => Promise<DesktopPartyStatement>;
      delete: (partyId: string) => Promise<void>;
    };
    activities: {
      list: () => Promise<DesktopActivityRow[]>;
    };
    products: {
      list: () => Promise<DesktopProductRow[]>;
    };
    invoices: {
      list: (args: { docType: 'sales' | 'purchase' }) => Promise<DesktopInvoiceRow[]>;
      create: (input: Record<string, unknown>) => Promise<{ id: string; docNumber: string; total: number; paidAmount: number }>;
      pay: (input: Record<string, unknown>) => Promise<{ id: string; docNumber: string }>;
      return: (input: Record<string, unknown>) => Promise<{ id: string; docNumber: string; total: number; cost: number }>;
      cancel: (input: { invoiceId: string; date: string }) => Promise<{ id: string; reversalEntryNumber: string }>;
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

export interface DesktopPartyRow {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  status: string;
  activity_id: string | null;
  balance: number;
}

export interface DesktopPartyInput {
  name: string;
  type: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  activityId: string | null;
  openingBalance: number;
  date: string;
}

export interface DesktopPartyStatement {
  party: Omit<DesktopPartyRow, 'balance'>;
  opening: number;
  closing: number;
  rows: {
    date: string;
    type: string;
    reference_type: string | null;
    reference_id: string | null;
    description: string | null;
    debit: number;
    credit: number;
  }[];
}

export interface DesktopProductRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  reorder_level_milli: number;
  quantity_milli: number;
  total_value: number;
  unit_cost: number;
  is_active: boolean;
  is_low_stock: boolean;
}

export interface DesktopInvoiceItemRow {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string;
  quantity_milli: number;
  unit: string;
  unit_price: number;
  discount: number;
  total: number;
}

export interface DesktopInvoiceRow {
  id: string;
  doc_number: string;
  date: string;
  doc_type: 'sales' | 'purchase';
  party_id: string;
  activity_id: string | null;
  subtotal: number;
  discount: number;
  total: number;
  paid_amount: number;
  outstanding: number;
  payment_method: string;
  status: string;
  notes: string | null;
  party_name: string;
  items: DesktopInvoiceItemRow[];
}

export interface DesktopActivityRow {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  sort_order: number;
}

declare global {
  interface Window {
    electronAPI?: DesktopApi;
  }
}

export function getDesktopApi(): DesktopApi | null {
  return window.electronAPI ?? null;
}
