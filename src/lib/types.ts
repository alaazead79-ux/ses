// الأنواع المشتركة عبر التطبيق

export type PageId =
  | 'dashboard'
  | 'treasury'
  | 'transfers'
  | 'checks'
  | 'sales'
  | 'parties'
  | 'expenses'
  | 'inventory'
  | 'accounting'
  | 'employees'
  | 'reports'
  | 'settings'
  | 'backup'
  | 'import';

export type RoleId = 'owner' | 'manager' | 'accountant' | 'user';

export interface Role {
  id: RoleId;
  label: string;
}

export const ROLES: Role[] = [
  { id: 'owner', label: 'المالك' },
  { id: 'manager', label: 'مدير' },
  { id: 'accountant', label: 'محاسب' },
  { id: 'user', label: 'مستخدم عادي' },
];
