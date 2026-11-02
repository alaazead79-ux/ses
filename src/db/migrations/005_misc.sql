-- ============================================================
-- Migration 005: Custom fields, report defs, backup logs, import batches
-- ============================================================

-- ===================== CUSTOM FIELDS =====================
CREATE TABLE IF NOT EXISTS custom_fields (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('party','product','employee','invoice','expense')),
  field_key   TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type  TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','number','date','boolean','select')),
  options     JSONB,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customfield_entity ON custom_fields(entity_type);

-- ===================== BACKUP LOGS =====================
CREATE TABLE IF NOT EXISTS backup_logs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  filename    TEXT NOT NULL,
  file_size   BIGINT,
  status      TEXT NOT NULL CHECK (status IN ('success','failed','restored')),
  is_manual   BOOLEAN NOT NULL DEFAULT false,
  notes       TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backup_created ON backup_logs(created_at DESC);

-- ===================== IMPORT BATCHES =====================
CREATE TABLE IF NOT EXISTS import_batches (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  filename    TEXT NOT NULL,
  file_type   TEXT NOT NULL,
  data_type   TEXT NOT NULL,
  total_rows  INTEGER NOT NULL DEFAULT 0,
  success_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','confirmed','imported','failed')),
  mapping     JSONB,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== IMPORT MAPPINGS =====================
CREATE TABLE IF NOT EXISTS import_mappings (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_id      TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_column TEXT NOT NULL,
  target_field  TEXT NOT NULL
);

-- ===================== IMPORT ROWS (preview/errors) =====================
CREATE TABLE IF NOT EXISTS import_rows (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_id    TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number  INTEGER NOT NULL,
  data        JSONB,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid')),
  errors      TEXT
);

INSERT INTO schema_migrations (id) VALUES ('005_misc') ON CONFLICT (id) DO NOTHING;
