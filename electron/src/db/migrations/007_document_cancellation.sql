-- Migration 007: cancellation tracking for expenses and incomes (reversal entries are posted, never edited)

ALTER TABLE expenses ADD COLUMN cancelled_at TEXT;
ALTER TABLE expenses ADD COLUMN cancel_journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT;

ALTER TABLE incomes ADD COLUMN cancelled_at TEXT;
ALTER TABLE incomes ADD COLUMN cancel_journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE RESTRICT;
