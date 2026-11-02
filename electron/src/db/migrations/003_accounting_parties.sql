-- Migration 003: chart of accounts, journal, opening balances, parties, cashboxes
-- Money is stored as integer piastres. Posted journal records are immutable.

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  parent_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);

INSERT OR IGNORE INTO accounts (id, code, name, type, is_system) VALUES
  ('acc_assets', '1', 'الأصول', 'asset', 1),
  ('acc_cash', '101', 'الخزينة', 'asset', 1),
  ('acc_bank', '102', 'البنوك', 'asset', 1),
  ('acc_ar', '110', 'العملاء (ذمم مدينة)', 'asset', 1),
  ('acc_inventory', '120', 'المخزون', 'asset', 1),
  ('acc_checks_recv', '130', 'الشيكات المستلمة', 'asset', 1),
  ('acc_advances_emp', '140', 'سلف الموظفين', 'asset', 1),
  ('acc_liabilities', '2', 'الخصوم', 'liability', 1),
  ('acc_ap', '201', 'الموردون (ذمم دائنة)', 'liability', 1),
  ('acc_checks_pay', '210', 'الشيكات الصادرة', 'liability', 1),
  ('acc_salaries_pay', '220', 'الرواتب المستحقة', 'liability', 1),
  ('acc_equity', '3', 'حقوق الملكية', 'equity', 1),
  ('acc_capital', '301', 'رأس المال', 'equity', 1),
  ('acc_retained', '302', 'الأرباح المرحّلة', 'equity', 1),
  ('acc_revenue', '4', 'الإيرادات', 'revenue', 1),
  ('acc_sales', '401', 'إيرادات المبيعات', 'revenue', 1),
  ('acc_sales_returns', '402', 'مرتجع المبيعات', 'revenue', 1),
  ('acc_other_income', '490', 'إيرادات متنوعة', 'revenue', 1),
  ('acc_expenses', '5', 'المصروفات', 'expense', 1),
  ('acc_cogs', '501', 'تكلفة البضاعة المباعة', 'expense', 1),
  ('acc_purchase_returns', '502', 'مرتجع المشتريات', 'expense', 1),
  ('acc_feed', '510', 'أعلاف', 'expense', 1),
  ('acc_meds', '511', 'أدوية', 'expense', 1),
  ('acc_labor', '512', 'أجور العمال', 'expense', 1),
  ('acc_utilities', '513', 'كهرباء ومياه', 'expense', 1),
  ('acc_maintenance', '514', 'صيانة', 'expense', 1),
  ('acc_transport', '515', 'نقل', 'expense', 1),
  ('acc_fuel', '516', 'وقود', 'expense', 1),
  ('acc_admin', '517', 'مصروفات إدارية', 'expense', 1),
  ('acc_salaries', '520', 'الرواتب', 'expense', 1),
  ('acc_inventory_adj', '521', 'فروق جرد المخزون', 'expense', 1);

CREATE TABLE IF NOT EXISTS journal_entries (
  id               TEXT PRIMARY KEY,
  entry_number     TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  description      TEXT,
  reference_type   TEXT,
  reference_id     TEXT,
  activity_id      TEXT REFERENCES activities(id) ON DELETE SET NULL,
  fiscal_period_id TEXT REFERENCES fiscal_periods(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','reversed')),
  is_reversing    INTEGER NOT NULL DEFAULT 0 CHECK (is_reversing IN (0, 1)),
  reversing_of     TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_activity ON journal_entries(activity_id);
CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(reference_type, reference_id);
-- one posting per source document; reversals are excluded so a document can be reversed once
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_source
  ON journal_entries(reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL AND is_reversing = 0;

CREATE TRIGGER IF NOT EXISTS trg_journal_entries_no_delete
BEFORE DELETE ON journal_entries
BEGIN
  SELECT RAISE(ABORT, 'لا يمكن حذف قيد محاسبي مرحّل');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_entries_immutable
BEFORE UPDATE ON journal_entries
WHEN NOT (OLD.status = 'posted' AND NEW.status = 'reversed'
  AND NEW.entry_number = OLD.entry_number AND NEW.date = OLD.date
  AND NEW.reference_type IS OLD.reference_type AND NEW.reference_id IS OLD.reference_id)
BEGIN
  SELECT RAISE(ABORT, 'القيد المحاسبي المرحّل لا يمكن تعديله');
END;

CREATE TABLE IF NOT EXISTS journal_lines (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit       INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (debit = 0 OR credit = 0),
  CHECK (debit + credit > 0)
);
CREATE INDEX IF NOT EXISTS idx_jlines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jlines_account ON journal_lines(account_id);

CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_update
BEFORE UPDATE ON journal_lines
BEGIN
  SELECT RAISE(ABORT, 'بنود القيد المحاسبي لا يمكن تعديلها');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_delete
BEFORE DELETE ON journal_lines
BEGIN
  SELECT RAISE(ABORT, 'بنود القيد المحاسبي لا يمكن حذفها');
END;

CREATE TABLE IF NOT EXISTS opening_balances (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  debit       INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (debit = 0 OR credit = 0)
);

CREATE TABLE IF NOT EXISTS parties (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('customer','supplier','both')),
  phone           TEXT,
  address         TEXT,
  contact         TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','blocked')),
  activity_id     TEXT REFERENCES activities(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_parties_type ON parties(type);
CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

CREATE TABLE IF NOT EXISTS party_transactions (
  id             TEXT PRIMARY KEY,
  party_id       TEXT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  date           TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  type           TEXT NOT NULL CHECK (type IN ('invoice','payment','return','opening','adjustment')),
  reference_type TEXT,
  reference_id   TEXT,
  debit          INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX IF NOT EXISTS idx_partytx_party ON party_transactions(party_id);
CREATE INDEX IF NOT EXISTS idx_partytx_date ON party_transactions(date);

CREATE TABLE IF NOT EXISTS cashboxes (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  account_id      TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  opening_balance INTEGER NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO cashboxes (id, name, account_id, opening_balance)
SELECT 'cashbox_main', app_settings.value, 'acc_cash', 0
FROM app_settings WHERE app_settings.key = 'default_cashbox_name'
ON CONFLICT(id) DO NOTHING;
