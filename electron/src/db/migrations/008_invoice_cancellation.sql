-- Migration 008: cancellation tracking for sales and purchase invoices (reversal entries are posted, never edited)

ALTER TABLE invoices ADD COLUMN cancelled_at TEXT;
ALTER TABLE invoices ADD COLUMN cancel_journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT;
