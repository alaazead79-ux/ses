-- ============================================================
-- Migration 002: Accounting — chart of accounts, journal entries/lines
-- ============================================================

-- ===================== CHART OF ACCOUNTS =====================
CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  parent_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  balance     BIGINT NOT NULL DEFAULT 0,  -- مخزّن كأصغر وحدة (قرش صعيد) لتجنب أخطاء الفواصل
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(code);

-- دليل الحسابات الأساسي (حسابات نظام)
INSERT INTO accounts (id, code, name, type, is_system) VALUES
  ('acc_assets', '1', 'الأصول', 'asset', true),
  ('acc_cash', '101', 'الخزينة', 'asset', true),
  ('acc_bank', '102', 'البنوك', 'asset', true),
  ('acc_ar', '110', 'العملاء (ذمم مدينة)', 'asset', true),
  ('acc_inventory', '120', 'المخزون', 'asset', true),
  ('acc_checks_recv', '130', 'الشيكات المستلمة', 'asset', true),
  ('acc_advances_emp', '140', 'سلف الموظفين', 'asset', true),
  ('acc_liabilities', '2', 'الخصوم', 'liability', true),
  ('acc_ap', '201', 'الموردون (ذمم دائنة)', 'liability', true),
  ('acc_checks_pay', '210', 'الشيكات الصادرة', 'liability', true),
  ('acc_salaries_pay', '220', 'الرواتب المستحقة', 'liability', true),
  ('acc_equity', '3', 'حقوق الملكية', 'equity', true),
  ('acc_capital', '301', 'رأس المال', 'equity', true),
  ('acc_retained', '302', 'الأرباح المرحّلة', 'equity', true),
  ('acc_revenue', '4', 'الإيرادات', 'revenue', true),
  ('acc_sales', '401', 'إيرادات المبيعات', 'revenue', true),
  ('acc_sales_returns', '402', 'مرتجع المبيعات', 'revenue', true),
  ('acc_other_income', '490', 'إيرادات متنوعة', 'revenue', true),
  ('acc_expenses', '5', 'المصروفات', 'expense', true),
  ('acc_cogs', '501', 'تكلفة البضاعة المباعة', 'expense', true),
  ('acc_purchase_returns', '502', 'مرتجع المشتريات', 'expense', true),
  ('acc_feed', '510', 'أعلاف', 'expense', true),
  ('acc_meds', '511', 'أدوية', 'expense', true),
  ('acc_labor', '512', 'أجور العمال', 'expense', true),
  ('acc_utilities', '513', 'كهرباء ومياه', 'expense', true),
  ('acc_maintenance', '514', 'صيانة', 'expense', true),
  ('acc_transport', '515', 'نقل', 'expense', true),
  ('acc_fuel', '516', 'وقود', 'expense', true),
  ('acc_admin', '517', 'مصروفات إدارية', 'expense', true),
  ('acc_salaries', '520', 'الرواتب', 'expense', true)
ON CONFLICT (code) DO NOTHING;

-- ===================== JOURNAL ENTRIES =====================
CREATE TABLE IF NOT EXISTS journal_entries (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entry_number  TEXT NOT NULL,
  date          DATE NOT NULL,
  description   TEXT,
  reference_type TEXT,
  reference_id   TEXT,
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  fiscal_period_id TEXT REFERENCES fiscal_periods(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','reversed')),
  is_reversing  BOOLEAN NOT NULL DEFAULT false,
  reversing_of  TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_activity ON journal_entries(activity_id);
CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(reference_type, reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_number ON journal_entries(entry_number);

-- ===================== JOURNAL LINES =====================
CREATE TABLE IF NOT EXISTS journal_lines (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entry_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit       BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jlines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jlines_account ON journal_lines(account_id);

-- ===================== OPENING BALANCES =====================
CREATE TABLE IF NOT EXISTS opening_balances (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit       BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  date        DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opening_account ON opening_balances(account_id);

INSERT INTO schema_migrations (id) VALUES ('002_accounting') ON CONFLICT (id) DO NOTHING;
