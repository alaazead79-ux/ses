-- Migration 001: core schema (SQLite) — roles, users, permissions, audit, settings, activities, fiscal periods, document sequences

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO roles (id, label) VALUES
  ('owner', 'المالك'),
  ('manager', 'مدير'),
  ('accountant', 'محاسب'),
  ('user', 'مستخدم عادي');

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       TEXT NOT NULL DEFAULT 'user' REFERENCES roles(id),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

INSERT OR IGNORE INTO permissions (id, label) VALUES
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
  ('audit.view', 'عرض سجل العمليات');

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  module      TEXT NOT NULL,
  entity_id   TEXT,
  entity_type TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  label       TEXT,
  category    TEXT NOT NULL DEFAULT 'general',
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO app_settings (key, value, label, category) VALUES
  ('farm_name', 'مزرعة المواشي', 'اسم المزرعة', 'general'),
  ('farm_logo', '', 'شعار المزرعة', 'general'),
  ('farm_phone', '', 'هاتف المزرعة', 'general'),
  ('farm_address', '', 'عنوان المزرعة', 'general'),
  ('currency', 'EGP', 'العملة', 'general'),
  ('fiscal_year_start', '01-01', 'بداية السنة المالية', 'general'),
  ('system_start_date', '', 'تاريخ بداية استخدام النظام', 'general'),
  ('default_cashbox_name', 'الخزينة الرئيسية', 'اسم الخزينة الافتراضية', 'general'),
  ('stock_alert_threshold', '5', 'حد التنبيه للمخزون', 'inventory'),
  ('valuation_method', 'weighted_average', 'طريقة تقييم المخزون', 'inventory');

CREATE TABLE IF NOT EXISTS activities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO activities (id, name, description, sort_order) VALUES
  ('fattening', 'التسمين', 'نشاط التسمين', 1),
  ('dairy', 'الألبان', 'نشاط الألبان', 2),
  ('breeding', 'التربية', 'نشاط التربية', 3),
  ('other', 'نشاط آخر', 'أنشطة أخرى', 4);

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  is_closed   INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),
  closed_at   TEXT,
  closed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT chk_fiscal_dates CHECK (end_date > start_date)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_dates ON fiscal_periods(start_date, end_date);

CREATE TABLE IF NOT EXISTS document_sequences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type     TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL DEFAULT '',
  next_number  INTEGER NOT NULL DEFAULT 1,
  padding      INTEGER NOT NULL DEFAULT 5,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO document_sequences (doc_type, prefix) VALUES
  ('sales_invoice', 'INV-S'),
  ('purchase_invoice', 'INV-P'),
  ('sales_return', 'RET-S'),
  ('purchase_return', 'RET-P'),
  ('receipt', 'RC'),
  ('payment', 'PM'),
  ('journal', 'JV'),
  ('check_in', 'CHK-I'),
  ('check_out', 'CHK-O'),
  ('transfer', 'TR');
