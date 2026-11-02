const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('./audit');

function nextDocNumber(db, docType) {
  const seq = db.prepare('SELECT prefix, next_number, padding FROM document_sequences WHERE doc_type = ?').get(docType);
  if (!seq) throw new Error(`نوع مستند غير معروف: ${docType}`);
  const number = `${seq.prefix}-${String(seq.next_number).padStart(seq.padding, '0')}`;
  db.prepare('UPDATE document_sequences SET next_number = next_number + 1, updated_at = ? WHERE doc_type = ?')
    .run(new Date().toISOString(), docType);
  return number;
}

function assertPeriodOpen(db, date) {
  const closed = db.prepare(`
    SELECT id FROM fiscal_periods WHERE is_closed = 1 AND start_date <= ? AND end_date >= ? LIMIT 1
  `).get(date, date);
  if (closed) throw new UserFacingError('الفترة المحاسبية لهذا التاريخ مغلقة');
  return db.prepare(`
    SELECT id FROM fiscal_periods WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1
  `).get(date, date)?.id ?? null;
}

function validateLines(db, lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new UserFacingError('القيد يحتاج سطرين على الأقل');
  }
  const accountStmt = db.prepare('SELECT id, is_active FROM accounts WHERE id = ?');
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) {
      throw new UserFacingError('مبلغ السطر غير صالح');
    }
    if ((debit === 0) === (credit === 0)) {
      throw new UserFacingError('كل سطر يجب أن يحتوي مدينًا أو دائنًا فقط');
    }
    const account = accountStmt.get(line.accountId);
    if (!account) throw new UserFacingError('حساب غير موجود في القيد');
    if (account.is_active !== 1) throw new UserFacingError('لا يمكن الترحيل إلى حساب معطل');
    totalDebit += debit;
    totalCredit += credit;
  }
  if (totalDebit !== totalCredit) {
    throw new UserFacingError('القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن');
  }
  if (totalDebit === 0) throw new UserFacingError('لا يمكن ترحيل قيد بقيمة صفر');
  return totalDebit;
}

/**
 * Posts a balanced journal entry. Must run inside the caller's transaction when
 * it is part of a larger operation; a nested call still runs atomically.
 */
function postJournalEntry(db, {
  date,
  description = null,
  referenceType = null,
  referenceId = null,
  activityId = null,
  lines,
  userId = null,
  isReversing = false,
  reversingOf = null,
}) {
  return db.transaction(() => {
    validateLines(db, lines);
    const fiscalPeriodId = assertPeriodOpen(db, date);
    const id = crypto.randomUUID();
    const entryNumber = nextDocNumber(db, 'journal');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO journal_entries (
        id, entry_number, date, description, reference_type, reference_id, activity_id,
        fiscal_period_id, status, is_reversing, reversing_of, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)
    `).run(
      id, entryNumber, date, description, referenceType, referenceId, activityId,
      fiscalPeriodId, isReversing ? 1 : 0, reversingOf, userId, now, now,
    );

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const line of lines) {
      insertLine.run(crypto.randomUUID(), id, line.accountId, line.debit ?? 0, line.credit ?? 0, line.description ?? null);
    }
    return { id, entryNumber };
  })();
}

function reverseManualJournalEntry(db, { entryId, date, userId }) {
  return db.transaction(() => {
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
    if (!entry) throw new UserFacingError('القيد غير موجود');
    if (entry.status !== 'posted') throw new UserFacingError('هذا القيد ملغى بالفعل');
    if (entry.is_reversing === 1) throw new UserFacingError('لا يمكن عكس قيد عكسي');
    if (entry.reference_type && entry.reference_type !== 'manual') {
      throw new UserFacingError('هذا القيد مرتبط بمستند. ألغِ المستند نفسه بدلًا من عكس القيد');
    }
    const lines = db.prepare('SELECT account_id, debit, credit, description FROM journal_lines WHERE entry_id = ? ORDER BY rowid').all(entryId);
    const result = postJournalEntry(db, {
      date,
      description: `قيد عكسي لـ ${entry.entry_number}`,
      referenceType: 'reversal',
      referenceId: entryId,
      activityId: entry.activity_id,
      userId,
      isReversing: true,
      reversingOf: entryId,
      lines: lines.map((line) => ({
        accountId: line.account_id,
        debit: line.credit,
        credit: line.debit,
        description: `عكس — ${line.description ?? ''}`.trim(),
      })),
    });
    db.prepare("UPDATE journal_entries SET status = 'reversed', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), entryId);
    audit(db, { userId, action: 'reverse', module: 'accounting', entityId: entryId, entityType: 'journal_entry', details: { reversedBy: result.entryNumber } });
    return result;
  })();
}

module.exports = { nextDocNumber, postJournalEntry, reverseManualJournalEntry, assertPeriodOpen };
