-- ============================================================
-- Migration 004: Inventory, products, stock movements, employees, salaries, attendance, advances
-- ============================================================

-- ===================== PRODUCTS (feed, supplies, meds, parts) =====================
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT NOT NULL,
  sku             TEXT,
  category        TEXT NOT NULL DEFAULT 'supplies' CHECK (category IN ('feed','supplies','medication','spare_parts','other')),
  unit            TEXT NOT NULL DEFAULT 'unit',
  reorder_level   NUMERIC(15,3) NOT NULL DEFAULT 0,
  avg_cost        BIGINT NOT NULL DEFAULT 0,
  quantity        NUMERIC(15,3) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  account_id      TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ===================== STOCK MOVEMENTS =====================
CREATE TABLE IF NOT EXISTS stock_movements (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date          DATE NOT NULL,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  type          TEXT NOT NULL CHECK (type IN ('purchase','sale','issue','adjustment','count')),
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  quantity      NUMERIC(15,3) NOT NULL,
  unit_cost     BIGINT NOT NULL DEFAULT 0,
  balance_after NUMERIC(15,3),
  reference_type TEXT,
  reference_id   TEXT,
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stockmv_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stockmv_date ON stock_movements(date);

-- ===================== STOCK COUNTS (inventory audits) =====================
CREATE TABLE IF NOT EXISTS stock_counts (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number  TEXT NOT NULL,
  date        DATE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','adjusted')),
  notes       TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  count_id      TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  system_qty    NUMERIC(15,3) NOT NULL DEFAULT 0,
  counted_qty   NUMERIC(15,3) NOT NULL DEFAULT 0,
  difference    NUMERIC(15,3) NOT NULL DEFAULT 0,
  unit_cost     BIGINT NOT NULL DEFAULT 0
);

-- ===================== EXPENSE CATEGORIES =====================
CREATE TABLE IF NOT EXISTS expense_categories (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO expense_categories (id, name, account_id, sort_order) VALUES
  ('ec_feed', 'أعلاف', 'acc_feed', 1),
  ('ec_meds', 'أدوية', 'acc_meds', 2),
  ('ec_labor', 'أجور العمال', 'acc_labor', 3),
  ('ec_utilities', 'كهرباء ومياه', 'acc_utilities', 4),
  ('ec_maintenance', 'صيانة', 'acc_maintenance', 5),
  ('ec_transport', 'نقل', 'acc_transport', 6),
  ('ec_fuel', 'وقود', 'acc_fuel', 7),
  ('ec_admin', 'مصروفات إدارية', 'acc_admin', 8)
ON CONFLICT (id) DO NOTHING;

-- ===================== EXPENSES =====================
CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number    TEXT NOT NULL,
  date          DATE NOT NULL,
  category_id   TEXT REFERENCES expense_categories(id) ON DELETE SET NULL,
  account_id    TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit','transfer','check')),
  cashbox_id    TEXT REFERENCES cashboxes(id) ON DELETE SET NULL,
  description   TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  is_shared     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_docnum ON expenses(doc_number);

-- ===================== EXPENSE DISTRIBUTION (shared cost allocation) =====================
CREATE TABLE IF NOT EXISTS expense_distributions (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  expense_id  TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  percentage  NUMERIC(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  amount      BIGINT NOT NULL DEFAULT 0
);

-- ===================== INCOME CATEGORIES =====================
CREATE TABLE IF NOT EXISTS income_categories (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO income_categories (id, name, account_id, sort_order) VALUES
  ('ic_sales', 'إيرادات المبيعات', 'acc_sales', 1),
  ('ic_dairy', 'إيرادات الألبان', 'acc_sales', 2),
  ('ic_other', 'إيرادات أخرى', 'acc_other_income', 3),
  ('ic_misc', 'إيرادات متنوعة', 'acc_other_income', 4)
ON CONFLICT (id) DO NOTHING;

-- ===================== INCOMES =====================
CREATE TABLE IF NOT EXISTS incomes (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number    TEXT NOT NULL,
  date          DATE NOT NULL,
  category_id   TEXT REFERENCES income_categories(id) ON DELETE SET NULL,
  account_id    TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit','transfer','check')),
  cashbox_id    TEXT REFERENCES cashboxes(id) ON DELETE SET NULL,
  party_id      TEXT REFERENCES parties(id) ON DELETE SET NULL,
  description   TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incomes_date ON incomes(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_incomes_docnum ON incomes(doc_number);

-- ===================== EMPLOYEES =====================
CREATE TABLE IF NOT EXISTS employees (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT NOT NULL,
  phone           TEXT,
  job_title       TEXT,
  hire_date       DATE,
  base_salary     BIGINT NOT NULL DEFAULT 0,
  salary_type     TEXT NOT NULL DEFAULT 'monthly' CHECK (salary_type IN ('monthly','daily','hourly')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','terminated')),
  activity_id     TEXT REFERENCES activities(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- ===================== ATTENDANCE =====================
CREATE TABLE IF NOT EXISTS attendance (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('present','absent','late','leave','holiday')),
  check_in    TIME,
  check_out   TIME,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_att_emp ON attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);

-- ===================== SALARY RECORDS =====================
CREATE TABLE IF NOT EXISTS salary_records (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month         DATE NOT NULL,
  base_salary   BIGINT NOT NULL DEFAULT 0,
  overtime      BIGINT NOT NULL DEFAULT 0,
  deductions    BIGINT NOT NULL DEFAULT 0,
  advance_deduct BIGINT NOT NULL DEFAULT 0,
  net_salary    BIGINT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at       TIMESTAMPTZ,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_emp ON salary_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_month ON salary_records(month);

-- ===================== EMPLOYEE ADVANCES =====================
CREATE TABLE IF NOT EXISTS employee_advances (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  repayment_method TEXT NOT NULL DEFAULT 'installment' CHECK (repayment_method IN ('installment','deduct_monthly','lump_sum')),
  installment_amount BIGINT NOT NULL DEFAULT 0,
  total_paid    BIGINT NOT NULL DEFAULT 0,
  remaining     BIGINT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled')),
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adv_emp ON employee_advances(employee_id);

INSERT INTO schema_migrations (id) VALUES ('004_inventory_hr') ON CONFLICT (id) DO NOTHING;
