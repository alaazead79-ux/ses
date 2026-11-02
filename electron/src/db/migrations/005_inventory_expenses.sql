-- Migration 005: warehouses, products, stock movements, stock counts, expenses and income

CREATE TABLE IF NOT EXISTS warehouses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO warehouses (id, name, is_default) VALUES ('wh_main', 'المخزن الرئيسي', 1);

-- quantity_milli: quantities in thousandths of a unit. total_value: stock value in piastres.
CREATE TABLE IF NOT EXISTS products (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  sku                 TEXT,
  category            TEXT NOT NULL DEFAULT 'supplies' CHECK (category IN ('feed','supplies','medication','spare_parts','other')),
  unit                TEXT NOT NULL DEFAULT 'unit',
  reorder_level_milli INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level_milli >= 0),
  quantity_milli      INTEGER NOT NULL DEFAULT 0 CHECK (quantity_milli >= 0),
  total_value         INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  account_id          TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (quantity_milli > 0 OR total_value = 0)
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku ON products(sku) WHERE sku IS NOT NULL AND sku <> '';

CREATE TABLE IF NOT EXISTS stock_movements (
  id                 TEXT PRIMARY KEY,
  date               TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id       TEXT NOT NULL DEFAULT 'wh_main' REFERENCES warehouses(id) ON DELETE RESTRICT,
  type               TEXT NOT NULL CHECK (type IN ('purchase','sale','sale_return','purchase_return','issue','adjustment','count')),
  direction          TEXT NOT NULL CHECK (direction IN ('in','out')),
  quantity_milli     INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_cost          INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost         INTEGER NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  quantity_after_milli INTEGER NOT NULL CHECK (quantity_after_milli >= 0),
  value_after        INTEGER NOT NULL CHECK (value_after >= 0),
  reference_type    TEXT,
  reference_id      TEXT,
  activity_id       TEXT REFERENCES activities(id) ON DELETE SET NULL,
  journal_entry_id  TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  notes             TEXT,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_stockmv_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stockmv_date ON stock_movements(date);

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_immutable
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'حركات المخزون لا يمكن تعديلها');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'حركات المخزون لا يمكن حذفها');
END;

CREATE TABLE IF NOT EXISTS stock_counts (
  id          TEXT PRIMARY KEY,
  doc_number  TEXT NOT NULL UNIQUE,
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  warehouse_id TEXT NOT NULL DEFAULT 'wh_main' REFERENCES warehouses(id) ON DELETE RESTRICT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','adjusted')),
  notes       TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id              TEXT PRIMARY KEY,
  count_id        TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE RESTRICT,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  system_qty_milli  INTEGER NOT NULL DEFAULT 0 CHECK (system_qty_milli >= 0),
  counted_qty_milli INTEGER NOT NULL DEFAULT 0 CHECK (counted_qty_milli >= 0),
  difference_milli  INTEGER NOT NULL DEFAULT 0,
  unit_cost         INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO expense_categories (id, name, account_id, sort_order) VALUES
  ('ec_feed', 'أعلاف', 'acc_feed', 1),
  ('ec_meds', 'أدوية', 'acc_meds', 2),
  ('ec_labor', 'أجور العمال', 'acc_labor', 3),
  ('ec_utilities', 'كهرباء ومياه', 'acc_utilities', 4),
  ('ec_maintenance', 'صيانة', 'acc_maintenance', 5),
  ('ec_transport', 'نقل', 'acc_transport', 6),
  ('ec_fuel', 'وقود', 'acc_fuel', 7),
  ('ec_admin', 'مصروفات إدارية', 'acc_admin', 8);

CREATE TABLE IF NOT EXISTS expenses (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  category_id      TEXT REFERENCES expense_categories(id) ON DELETE SET NULL,
  account_id       TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  activity_id      TEXT REFERENCES activities(id) ON DELETE SET NULL,
  payment_method   TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit','transfer','check')),
  cashbox_id       TEXT REFERENCES cashboxes(id) ON DELETE RESTRICT,
  description      TEXT,
  is_shared        INTEGER NOT NULL DEFAULT 0 CHECK (is_shared IN (0, 1)),
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (payment_method = 'credit' OR cashbox_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

CREATE TABLE IF NOT EXISTS expense_distributions (
  id          TEXT PRIMARY KEY,
  expense_id  TEXT NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  basis_points INTEGER NOT NULL CHECK (basis_points >= 0 AND basis_points <= 10000),
  amount      INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  UNIQUE (expense_id, activity_id)
);

CREATE TABLE IF NOT EXISTS income_categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO income_categories (id, name, account_id, sort_order) VALUES
  ('ic_sales', 'إيرادات المبيعات', 'acc_sales', 1),
  ('ic_dairy', 'إيرادات الألبان', 'acc_sales', 2),
  ('ic_other', 'إيرادات أخرى', 'acc_other_income', 3),
  ('ic_misc', 'إيرادات متنوعة', 'acc_other_income', 4);

CREATE TABLE IF NOT EXISTS incomes (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  category_id      TEXT REFERENCES income_categories(id) ON DELETE SET NULL,
  account_id       TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  activity_id      TEXT REFERENCES activities(id) ON DELETE SET NULL,
  payment_method   TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit','transfer','check')),
  cashbox_id       TEXT REFERENCES cashboxes(id) ON DELETE RESTRICT,
  party_id         TEXT REFERENCES parties(id) ON DELETE SET NULL,
  description      TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (payment_method = 'credit' OR cashbox_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_incomes_date ON incomes(date);
