-- ============================================================
-- Migration 003: Parties, invoices, payments, returns, cashboxes, cash, transfers, checks
-- ============================================================

-- ===================== PARTIES (customers + suppliers) =====================
CREATE TABLE IF NOT EXISTS parties (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('customer','supplier','both')),
  phone           TEXT,
  address         TEXT,
  contact         TEXT,
  opening_balance BIGINT NOT NULL DEFAULT 0,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','blocked')),
  activity_id     TEXT REFERENCES activities(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parties_type ON parties(type);
CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

-- ===================== PARTY TRANSACTIONS =====================
CREATE TABLE IF NOT EXISTS party_transactions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  party_id      TEXT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  date          DATE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('invoice','payment','return','opening','adjustment')),
  reference_type TEXT,
  reference_id   TEXT,
  debit         BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit        BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partytx_party ON party_transactions(party_id);
CREATE INDEX IF NOT EXISTS idx_partytx_date ON party_transactions(date);

-- ===================== CASHBOXES =====================
CREATE TABLE IF NOT EXISTS cashboxes (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT NOT NULL,
  opening_balance BIGINT NOT NULL DEFAULT 0,
  balance         BIGINT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== CASH TRANSACTIONS =====================
CREATE TABLE IF NOT EXISTS cash_transactions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number    TEXT NOT NULL,
  date          DATE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('receipt','payment','deposit','withdrawal','opening')),
  cashbox_id    TEXT NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  party_id      TEXT REFERENCES parties(id) ON DELETE SET NULL,
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  account_id    TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','transfer','check','credit')),
  description   TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_transactions(date);
CREATE INDEX IF NOT EXISTS idx_cash_type ON cash_transactions(type);
CREATE INDEX IF NOT EXISTS idx_cash_cashbox ON cash_transactions(cashbox_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_docnum ON cash_transactions(doc_number);

-- ===================== FINANCIAL TRANSFERS =====================
CREATE TABLE IF NOT EXISTS financial_transfers (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number    TEXT NOT NULL,
  ref_number    TEXT,
  date          DATE NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  amount        BIGINT NOT NULL CHECK (amount > 0),
  party_id      TEXT REFERENCES parties(id) ON DELETE SET NULL,
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  method        TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('bank_transfer','wire','mobile_wallet','other')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  description   TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfer_date ON financial_transfers(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_docnum ON financial_transfers(doc_number);

-- ===================== CHECKS =====================
CREATE TABLE IF NOT EXISTS checks (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number    TEXT NOT NULL,
  check_number  TEXT,
  bank_name     TEXT,
  direction     TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  party_id      TEXT REFERENCES parties(id) ON DELETE SET NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  issue_date    DATE,
  due_date     DATE NOT NULL,
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','issued','due','collected','paid','returned','cancelled')),
  description   TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checks_due ON checks(due_date);
CREATE INDEX IF NOT EXISTS idx_checks_status ON checks(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checks_docnum ON checks(doc_number);

-- ===================== INVOICES =====================
CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number    TEXT NOT NULL,
  date          DATE NOT NULL,
  doc_type      TEXT NOT NULL CHECK (doc_type IN ('sales','purchase','sales_return','purchase_return')),
  party_id      TEXT REFERENCES parties(id) ON DELETE RESTRICT,
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit','transfer','check')),
  status        TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','cancelled')),
  subtotal      BIGINT NOT NULL DEFAULT 0,
  discount      BIGINT NOT NULL DEFAULT 0,
  total         BIGINT NOT NULL DEFAULT 0,
  paid_amount   BIGINT NOT NULL DEFAULT 0,
  notes         TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(doc_type);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_docnum ON invoices(doc_number);

-- ===================== INVOICE ITEMS =====================
CREATE TABLE IF NOT EXISTS invoice_items (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id  TEXT,
  description TEXT,
  quantity    NUMERIC(15,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit        TEXT,
  unit_price  BIGINT NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount    BIGINT NOT NULL DEFAULT 0,
  total       BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitems_invoice ON invoice_items(invoice_id);

-- ===================== PAYMENTS =====================
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number    TEXT NOT NULL,
  date          DATE NOT NULL,
  invoice_id    TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  party_id      TEXT REFERENCES parties(id) ON DELETE SET NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','transfer','check')),
  cashbox_id    TEXT REFERENCES cashboxes(id) ON DELETE SET NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  description   TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_docnum ON payments(doc_number);

-- ===================== RETURNS =====================
CREATE TABLE IF NOT EXISTS returns (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_number    TEXT NOT NULL,
  date          DATE NOT NULL,
  return_type   TEXT NOT NULL CHECK (return_type IN ('sales_return','purchase_return')),
  invoice_id    TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  party_id      TEXT REFERENCES parties(id) ON DELETE SET NULL,
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  total         BIGINT NOT NULL DEFAULT 0,
  reason        TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_docnum ON returns(doc_number);

INSERT INTO schema_migrations (id) VALUES ('003_commerce') ON CONFLICT (id) DO NOTHING;
