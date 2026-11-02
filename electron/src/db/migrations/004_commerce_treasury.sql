-- Migration 004: sales and purchases, returns, payments, cashbox ledger, transfers, checks

CREATE TABLE IF NOT EXISTS cash_transactions (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  type             TEXT NOT NULL CHECK (type IN ('receipt','payment','deposit','withdrawal','opening')),
  direction        TEXT NOT NULL CHECK (direction IN ('in','out')),
  cashbox_id       TEXT NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  party_id         TEXT REFERENCES parties(id) ON DELETE RESTRICT,
  invoice_id       TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  payment_method   TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','transfer','check','credit')),
  source_type      TEXT,
  source_id        TEXT,
  description      TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_transactions(date);
CREATE INDEX IF NOT EXISTS idx_cash_cashbox ON cash_transactions(cashbox_id);
CREATE INDEX IF NOT EXISTS idx_cash_source ON cash_transactions(source_type, source_id);

CREATE TRIGGER IF NOT EXISTS trg_cash_transactions_immutable
BEFORE UPDATE ON cash_transactions
BEGIN
  SELECT RAISE(ABORT, 'حركات الخزينة لا يمكن تعديلها');
END;

CREATE TRIGGER IF NOT EXISTS trg_cash_transactions_no_delete
BEFORE DELETE ON cash_transactions
BEGIN
  SELECT RAISE(ABORT, 'حركات الخزينة لا يمكن حذفها');
END;

CREATE TABLE IF NOT EXISTS invoices (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  doc_type         TEXT NOT NULL CHECK (doc_type IN ('sales','purchase')),
  party_id         TEXT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  activity_id      TEXT REFERENCES activities(id) ON DELETE SET NULL,
  payment_method   TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit','transfer','check')),
  status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
  subtotal         INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount         INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total            INTEGER NOT NULL CHECK (total > 0),
  paid_amount      INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  cost_total       INTEGER NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  notes            TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (paid_amount <= total)
);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(doc_type);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  product_id      TEXT REFERENCES products(id) ON DELETE RESTRICT,
  description     TEXT NOT NULL,
  quantity_milli  INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit            TEXT,
  unit_price      INTEGER NOT NULL CHECK (unit_price >= 0),
  discount        INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total           INTEGER NOT NULL CHECK (total >= 0),
  unit_cost       INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  cost_total      INTEGER NOT NULL DEFAULT 0 CHECK (cost_total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_invitems_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invitems_product ON invoice_items(product_id);

CREATE TABLE IF NOT EXISTS returns (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  return_type      TEXT NOT NULL CHECK (return_type IN ('sales_return','purchase_return')),
  invoice_id       TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  party_id         TEXT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  activity_id      TEXT REFERENCES activities(id) ON DELETE SET NULL,
  payment_method   TEXT NOT NULL DEFAULT 'credit' CHECK (payment_method IN ('cash','credit')),
  total            INTEGER NOT NULL CHECK (total > 0),
  cost_total       INTEGER NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  reason           TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_returns_invoice ON returns(invoice_id);

CREATE TABLE IF NOT EXISTS return_items (
  id              TEXT PRIMARY KEY,
  return_id       TEXT NOT NULL REFERENCES returns(id) ON DELETE RESTRICT,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_milli  INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price      INTEGER NOT NULL CHECK (unit_price >= 0),
  total           INTEGER NOT NULL CHECK (total >= 0),
  unit_cost       INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  cost_total      INTEGER NOT NULL DEFAULT 0 CHECK (cost_total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);

CREATE TABLE IF NOT EXISTS payments (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  invoice_id       TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  party_id         TEXT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  payment_method   TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','transfer','check')),
  cashbox_id       TEXT NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  description      TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id);

CREATE TABLE IF NOT EXISTS financial_transfers (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  ref_number       TEXT,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  direction        TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  amount           INTEGER NOT NULL CHECK (amount > 0),
  party_id         TEXT REFERENCES parties(id) ON DELETE SET NULL,
  activity_id      TEXT REFERENCES activities(id) ON DELETE SET NULL,
  method           TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('bank_transfer','wire','mobile_wallet','other')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  description      TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_transfer_date ON financial_transfers(date);

CREATE TABLE IF NOT EXISTS checks (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  check_number     TEXT,
  bank_name        TEXT,
  direction        TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  party_id         TEXT REFERENCES parties(id) ON DELETE SET NULL,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  issue_date       TEXT CHECK (issue_date IS NULL OR issue_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_date         TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  activity_id      TEXT REFERENCES activities(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','issued','due','collected','paid','returned','cancelled')),
  description      TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_checks_due ON checks(due_date);
CREATE INDEX IF NOT EXISTS idx_checks_status ON checks(status);
