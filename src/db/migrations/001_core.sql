-- ============================================================
-- Migration 001: Core schema — users, roles, permissions, audit, settings, activities, fiscal periods
-- ============================================================

-- ===================== ROLES =====================
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO roles (id, label) VALUES
  ('owner', 'المالك'),
  ('manager', 'مدير'),
  ('accountant', 'محاسب'),
  ('user', 'مستخدم عادي')
ON CONFLICT (id) DO NOTHING;

-- ===================== USERS =====================
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       TEXT NOT NULL REFERENCES roles(id) DEFAULT 'user',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== PERMISSIONS =====================
CREATE TABLE IF NOT EXISTS permissions (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

INSERT INTO permissions (id, label) VALUES
  ('dashboard.view', 'عرض لوحة التحكم'),
  ('treasury.view', 'عرض الخزينة'),
  ('treasury.add', 'إضافة حركة خزينة'),
  ('treasury.edit', 'تعديل حركة خزينة'),
  ('treasury.delete', 'حذف حركة خزينة'),
  ('treasury.print', 'طباعة سندات الخزينة'),
  ('transfers.view', 'عرض التحويلات'),
  ('transfers.add', 'إضافة تحويل'),
  ('transfers.edit', 'تعديل تحويل'),
  ('transfers.delete', 'حذف تحويل'),
  ('checks.view', 'عرض الشيكات'),
  ('checks.add', 'إضافة شيك'),
  ('checks.edit', 'تعديل شيك'),
  ('checks.delete', 'حذف شيك'),
  ('sales.view', 'عرض المبيعات والمشتريات'),
  ('sales.add', 'إضافة فاتورة'),
  ('sales.edit', 'تعديل فاتورة'),
  ('sales.delete', 'حذف فاتورة'),
  ('sales.print', 'طباعة فاتورة'),
  ('parties.view', 'عرض العملاء والموردين'),
  ('parties.add', 'إضافة طرف'),
  ('parties.edit', 'تعديل طرف'),
  ('parties.delete', 'حذف طرف'),
  ('expenses.view', 'عرض المصروفات والإيرادات'),
  ('expenses.add', 'إضافة مصروف/إيراد'),
  ('expenses.edit', 'تعديل مصروف/إيراد'),
  ('expenses.delete', 'حذف مصروف/إيراد'),
  ('inventory.view', 'عرض المخزون'),
  ('inventory.add', 'إضافة صنف'),
  ('inventory.edit', 'تعديل صنف'),
  ('inventory.delete', 'حذف صنف'),
  ('accounting.view', 'عرض الحسابات'),
  ('accounting.add', 'إضافة قيد'),
  ('accounting.edit', 'تعديل قيد'),
  ('accounting.delete', 'حذف قيد'),
  ('employees.view', 'عرض الموظفين'),
  ('employees.add', 'إضافة موظف'),
  ('employees.edit', 'تعديل موظف'),
  ('employees.delete', 'حذف موظف'),
  ('reports.view', 'عرض التقارير'),
  ('reports.export', 'تصدير التقارير'),
  ('settings.view', 'عرض الإعدادات'),
  ('settings.edit', 'تعديل الإعدادات'),
  ('users.manage', 'إدارة المستخدمين والصلاحيات'),
  ('backup.view', 'عرض النسخ الاحتياطي'),
  ('backup.create', 'إنشاء نسخة احتياطية'),
  ('backup.restore', 'استعادة نسخة'),
  ('import.run', 'استيراد بيانات'),
  ('audit.view', 'عرض سجل العمليات')
ON CONFLICT (id) DO NOTHING;

-- ===================== USER_PERMISSIONS =====================
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, permission_id)
);

-- ===================== AUDIT LOGS =====================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  module      TEXT NOT NULL,
  entity_id   TEXT,
  entity_type TEXT,
  details     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);

-- ===================== APP SETTINGS =====================
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  label       TEXT,
  category    TEXT NOT NULL DEFAULT 'general',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO app_settings (key, value, label, category) VALUES
  ('farm_name', 'مزرعة المواشي', 'اسم المزرعة', 'general'),
  ('farm_logo', '', 'شعار المزرعة', 'general'),
  ('farm_phone', '', 'هاتف المزرعة', 'general'),
  ('farm_address', '', 'عنوان المزرعة', 'general'),
  ('currency', 'EGP', 'العملة', 'general'),
  ('fiscal_year_start', '01-01', 'بداية السنة المالية', 'general'),
  ('system_start_date', '', 'تاريخ بداية استخدام النظام', 'general'),
  ('default_cashbox_name', 'الخزينة الرئيسية', 'اسم الخزينة الافتراضية', 'general'),
  ('stock_alert_threshold', '5', 'حد التنبيه للمخزون', 'inventory'),
  ('valuation_method', 'weighted_average', 'طريقة تقييم المخزون', 'inventory')
ON CONFLICT (key) DO NOTHING;

-- ===================== ACTIVITIES =====================
CREATE TABLE IF NOT EXISTS activities (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO activities (id, name, description, sort_order) VALUES
  ('fattening', 'التسمين', 'نشاط التسمين', 1),
  ('dairy', 'الألبان', 'نشاط الألبان', 2),
  ('breeding', 'التربية', 'نشاط التربية', 3),
  ('other', 'نشاط آخر', 'أنشطة أخرى', 4)
ON CONFLICT (id) DO NOTHING;

-- ===================== FISCAL PERIODS =====================
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  is_closed   BOOLEAN NOT NULL DEFAULT false,
  closed_at   TIMESTAMPTZ,
  closed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_fiscal_dates CHECK (end_date > start_date)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_dates ON fiscal_periods(start_date, end_date);

-- ===================== DOCUMENT SEQUENCES =====================
CREATE TABLE IF NOT EXISTS document_sequences (
  id           SERIAL PRIMARY KEY,
  doc_type     TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL DEFAULT '',
  next_number  INTEGER NOT NULL DEFAULT 1,
  padding      INTEGER NOT NULL DEFAULT 5,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO document_sequences (doc_type, prefix) VALUES
  ('sales_invoice', 'INV-S'),
  ('purchase_invoice', 'INV-P'),
  ('sales_return', 'RET-S'),
  ('purchase_return', 'RET-P'),
  ('receipt', 'RC'),
  ('payment', 'PM'),
  ('journal', 'JV'),
  ('check_in', 'CHK-I'),
  ('check_out', 'CHK-O'),
  ('transfer', 'TR')
ON CONFLICT (doc_type) DO NOTHING;

-- ===================== SCHEMA VERSION =====================
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (id) VALUES ('001_core') ON CONFLICT (id) DO NOTHING;
