-- Migration 006: employees and payroll, customization, import and backup logs, extra document sequences

INSERT OR IGNORE INTO document_sequences (doc_type, prefix) VALUES
  ('expense', 'EXP'),
  ('income', 'INC'),
  ('deposit', 'DEP'),
  ('withdrawal', 'WD'),
  ('opening', 'OPN'),
  ('stock_adjustment', 'ADJ'),
  ('salary', 'SAL'),
  ('advance', 'ADV');

CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  job_title     TEXT,
  hire_date     TEXT CHECK (hire_date IS NULL OR hire_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  base_salary   INTEGER NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  salary_type   TEXT NOT NULL DEFAULT 'monthly' CHECK (salary_type IN ('monthly','daily','hourly')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','terminated')),
  activity_id   TEXT REFERENCES activities(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

CREATE TABLE IF NOT EXISTS attendance (
  id           TEXT PRIMARY KEY,
  employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  date         TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status       TEXT NOT NULL CHECK (status IN ('present','absent','late','leave','holiday')),
  check_in     TEXT,
  check_out    TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS employee_advances (
  id                 TEXT PRIMARY KEY,
  doc_number         TEXT NOT NULL UNIQUE,
  employee_id        TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  date               TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount             INTEGER NOT NULL CHECK (amount > 0),
  repayment_method   TEXT NOT NULL DEFAULT 'installment' CHECK (repayment_method IN ('installment','deduct_monthly','lump_sum')),
  installment_amount INTEGER NOT NULL DEFAULT 0 CHECK (installment_amount >= 0),
  total_paid         INTEGER NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
  remaining          INTEGER NOT NULL DEFAULT 0 CHECK (remaining >= 0),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled')),
  journal_entry_id   TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS salary_records (
  id               TEXT PRIMARY KEY,
  doc_number       TEXT NOT NULL UNIQUE,
  employee_id      TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  month            TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  base_salary      INTEGER NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  overtime         INTEGER NOT NULL DEFAULT 0 CHECK (overtime >= 0),
  deductions       INTEGER NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  advance_deduct   INTEGER NOT NULL DEFAULT 0 CHECK (advance_deduct >= 0),
  net_salary       INTEGER NOT NULL DEFAULT 0 CHECK (net_salary >= 0),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at          TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS salary_items (
  id          TEXT PRIMARY KEY,
  salary_id   TEXT NOT NULL REFERENCES salary_records(id) ON DELETE RESTRICT,
  kind        TEXT NOT NULL CHECK (kind IN ('earning','overtime','deduction','advance')),
  label       TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount >= 0)
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('party','product','employee','invoice','expense')),
  field_key    TEXT NOT NULL,
  field_label  TEXT NOT NULL,
  field_type   TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','number','date','boolean','select')),
  options      TEXT,
  is_required  INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (entity_type, field_key)
);

CREATE TABLE IF NOT EXISTS custom_forms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  layout      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS custom_categories (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS report_definitions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  definition  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS import_batches (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL,
  file_type    TEXT NOT NULL,
  data_type    TEXT NOT NULL,
  total_rows   INTEGER NOT NULL DEFAULT 0,
  success_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','confirmed','imported','failed')),
  mapping      TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS import_mappings (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_column TEXT NOT NULL,
  target_field  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_rows (
  id          TEXT PRIMARY KEY,
  batch_id    TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number  INTEGER NOT NULL,
  data        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid')),
  errors      TEXT
);

CREATE TABLE IF NOT EXISTS backup_logs (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  file_size   INTEGER,
  status      TEXT NOT NULL CHECK (status IN ('success','failed','restored')),
  is_manual   INTEGER NOT NULL DEFAULT 0 CHECK (is_manual IN (0, 1)),
  notes       TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_backup_created ON backup_logs(created_at);
