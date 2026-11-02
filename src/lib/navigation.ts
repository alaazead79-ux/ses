import type { PageId } from './types';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  FileCheck,
  Receipt,
  Users,
  TrendingDown,
  Boxes,
  BookOpen,
  UserCircle,
  FileBarChart,
  Settings,
  DatabaseBackup,
  Upload,
} from 'lucide-react';

export interface NavItem {
  id: PageId;
  label: string;
  icon: typeof LayoutDashboard;
  group: string;
  permission: string;
}

// ترتيب القائمة الجانبية — مجمّعة حسب المجموعة
export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, group: 'الرئيسية', permission: 'dashboard.view' },

  { id: 'treasury', label: 'الخزينة', icon: Wallet, group: 'العمليات المالية', permission: 'treasury.view' },
  { id: 'transfers', label: 'التحويلات والحركات البنكية', icon: ArrowLeftRight, group: 'العمليات المالية', permission: 'transfers.view' },
  { id: 'checks', label: 'الشيكات', icon: FileCheck, group: 'العمليات المالية', permission: 'checks.view' },

  { id: 'sales', label: 'المبيعات والمشتريات', icon: Receipt, group: 'التجارة', permission: 'sales.view' },
  { id: 'parties', label: 'العملاء والموردون', icon: Users, group: 'التجارة', permission: 'parties.view' },

  { id: 'expenses', label: 'المصروفات والإيرادات', icon: TrendingDown, group: 'العمليات', permission: 'expenses.view' },
  { id: 'inventory', label: 'المخازن', icon: Boxes, group: 'العمليات', permission: 'inventory.view' },
  { id: 'employees', label: 'الموظفون والرواتب', icon: UserCircle, group: 'العمليات', permission: 'employees.view' },

  { id: 'accounting', label: 'الحسابات العامة', icon: BookOpen, group: 'المحاسبة', permission: 'accounting.view' },
  { id: 'reports', label: 'التقارير', icon: FileBarChart, group: 'المحاسبة', permission: 'reports.view' },

  { id: 'import', label: 'استيراد البيانات', icon: Upload, group: 'النظام', permission: 'import.run' },
  { id: 'backup', label: 'النسخ الاحتياطي', icon: DatabaseBackup, group: 'النظام', permission: 'backup.view' },
  { id: 'settings', label: 'الإعدادات', icon: Settings, group: 'النظام', permission: 'settings.view' },
];

export const NAV_GROUPS = Array.from(new Set(NAV_ITEMS.map((i) => i.group)));
