const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { assertIsoDate, requireText, optionalText, toPiastres } = require('../domain/money');
const { nextDocNumber, postJournalEntry } = require('../domain/postingEngine');

const CHECK_STATUS_BY_DIRECTION = {
  incoming: { next: { received: ['collected', 'returned', 'cancelled'] } },
  outgoing: { next: { issued: ['paid', 'returned', 'cancelled'] } },
};
const TRANSFER_STATUSES = ['pending', 'completed', 'cancelled'];

function cashboxBalanceSql() {
  return `
    SELECT b.id, b.name, b.account_id, b.opening_balance, b.is_active,
      b.opening_balance
        + COALESCE((SELECT SUM(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END)
                    FROM cash_transactions t WHERE t.cashbox_id = b.id), 0) AS balance
    FROM cashboxes b
  `;
}

function requireActiveCashbox(db, cashboxId) {
  const box = db.prepare('SELECT id, name, account_id, is_active FROM cashboxes WHERE id = ?').get(String(cashboxId ?? ''));
  if (!box || box.is_active !== 1) throw new UserFacingError('الخزينة غير موجودة أو غير مفعّلة');
  return box;
}

function cashboxBalance(db, cashboxId) {
  return db.prepare(`${cashboxBalanceSql()} WHERE b.id = ?`).get(cashboxId).balance;
}

function insertCashTransaction(db, {
  docNumber, date, type, direction, cashboxId, amount, sourceType, sourceId, description = null, journalEntryId, userId,
}) {
  db.prepare(`
    INSERT INTO cash_transactions (id, doc_number, date, type, direction, cashbox_id, amount, payment_method,
      source_type, source_id, description, journal_entry_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), docNumber, date, type, direction, cashboxId, amount,
    sourceType, sourceId, description, journalEntryId, userId);
}

function listCashboxes(db) {
  return db.prepare(`${cashboxBalanceSql()} ORDER BY b.name`).all()
    .map((row) => ({ ...row, is_active: row.is_active === 1 }));
}

function nextCashboxAccountCode(db) {
  for (let i = 1; i < 100; i += 1) {
    const code = `101${String(i).padStart(2, '0')}`;
    if (!db.prepare('SELECT id FROM accounts WHERE code = ?').get(code)) return code;
  }
  throw new UserFacingError('تعذر إنشاء حساب للخزينة الجديدة');
}

// الرصيد الافتتاحي يُرحَّل كقيد: مدين الخزينة / دائن رأس المال
function createCashbox(db, userId, input) {
  const name = requireText(input?.name, 'اسم الخزينة', 80);
  const opening = toPiastres(input?.openingBalance ?? 0, 'الرصيد الافتتاحي', { allowZero: true });
  const date = assertIsoDate(input?.date);
  return db.transaction(() => {
    const accountId = crypto.randomUUID();
    const cashboxId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO accounts (id, code, name, type, parent_id) VALUES (?, ?, ?, 'asset', 'acc_cash')
    `).run(accountId, nextCashboxAccountCode(db), `خزينة — ${name}`);
    if (opening > 0) {
      postJournalEntry(db, {
        date,
        description: `رصيد افتتاحي للخزينة ${name}`,
        referenceType: 'cashbox_opening',
        referenceId: cashboxId,
        userId,
        lines: [
          { accountId, debit: opening, description: name },
          { accountId: 'acc_capital', credit: opening, description: 'مقابل رصيد الخزينة الافتتاحي' },
        ],
      });
    }
    db.prepare('INSERT INTO cashboxes (id, name, account_id, opening_balance) VALUES (?, ?, ?, ?)')
      .run(cashboxId, name, accountId, opening);
    audit(db, { userId, action: 'create', module: 'treasury', entityId: cashboxId, entityType: 'cashbox', details: { name, opening } });
    return { id: cashboxId };
  })();
}

function cashStatement(db, { cashboxId, dateFrom = null, dateTo = null }) {
  const box = db.prepare(`${cashboxBalanceSql()} WHERE b.id = ?`).get(String(cashboxId ?? ''));
  if (!box) throw new UserFacingError('الخزينة غير موجودة');
  const from = dateFrom ? assertIsoDate(dateFrom) : null;
  const to = dateTo ? assertIsoDate(dateTo) : null;
  const before = from
    ? db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS net
      FROM cash_transactions WHERE cashbox_id = ? AND date < ?
    `).get(box.id, from).net
    : 0;
  const conditions = ['cashbox_id = ?'];
  const params = [box.id];
  if (from) { conditions.push('date >= ?'); params.push(from); }
  if (to) { conditions.push('date <= ?'); params.push(to); }
  const rows = db.prepare(`
    SELECT doc_number, date, type, direction, amount, description, created_at
    FROM cash_transactions WHERE ${conditions.join(' AND ')} ORDER BY date, created_at, rowid
  `).all(...params);
  let running = box.opening_balance + before;
  const statement = rows.map((row) => {
    running += row.direction === 'in' ? row.amount : -row.amount;
    return { ...row, balance: running };
  });
  return { cashbox: box, opening: box.opening_balance + before, rows: statement, closing: running };
}

function listTransfers(db) {
  return db.prepare(`
    SELECT t.id, t.doc_number, t.ref_number, t.date, t.direction, t.amount, t.method, t.status, t.description,
      p.name AS party_name
    FROM financial_transfers t LEFT JOIN parties p ON p.id = t.party_id
    ORDER BY t.date DESC, t.doc_number DESC LIMIT 300
  `).all();
}

// التحويلات سجل للمتابعة فقط ولا ترحَّل إلى الحسابات لعدم وجود حسابات بنكية
function createTransfer(db, userId, input) {
  const direction = input?.direction;
  if (direction !== 'inbound' && direction !== 'outbound') throw new UserFacingError('اتجاه التحويل غير صالح');
  const date = assertIsoDate(input?.date);
  const amount = toPiastres(input?.amount, 'المبلغ');
  const method = input?.method ?? 'bank_transfer';
  if (!['bank_transfer', 'wire', 'mobile_wallet', 'other'].includes(method)) throw new UserFacingError('طريقة التحويل غير صالحة');
  const partyId = input?.partyId ? String(input.partyId) : null;
  if (partyId && !db.prepare('SELECT id FROM parties WHERE id = ?').get(partyId)) throw new UserFacingError('الطرف غير موجود');
  const id = crypto.randomUUID();
  const docNumber = nextDocNumber(db, 'transfer');
  db.prepare(`
    INSERT INTO financial_transfers (id, doc_number, ref_number, date, direction, amount, party_id, method, status, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, docNumber, optionalText(input?.refNumber, 60), date, direction, amount, partyId, method,
    optionalText(input?.description, 300), userId);
  audit(db, { userId, action: 'create', module: 'treasury', entityId: id, entityType: 'transfer', details: { docNumber, amount } });
  return { id, docNumber };
}

function updateTransferStatus(db, userId, transferId, status) {
  const transfer = db.prepare('SELECT id, status FROM financial_transfers WHERE id = ?').get(String(transferId ?? ''));
  if (!transfer) throw new UserFacingError('التحويل غير موجود');
  if (!TRANSFER_STATUSES.includes(status) || transfer.status !== 'pending') {
    throw new UserFacingError('لا يمكن تغيير حالة هذا التحويل');
  }
  db.prepare('UPDATE financial_transfers SET status = ? WHERE id = ?').run(status, transfer.id);
  audit(db, { userId, action: 'update', module: 'treasury', entityId: transfer.id, entityType: 'transfer', details: { status } });
}

function listChecks(db) {
  return db.prepare(`
    SELECT c.id, c.doc_number, c.check_number, c.bank_name, c.direction, c.amount, c.due_date, c.status,
      p.name AS party_name
    FROM checks c LEFT JOIN parties p ON p.id = c.party_id
    ORDER BY c.due_date, c.doc_number
  `).all();
}

function createCheck(db, userId, input) {
  const direction = input?.direction;
  if (direction !== 'incoming' && direction !== 'outgoing') throw new UserFacingError('اتجاه الشيك غير صالح');
  const amount = toPiastres(input?.amount, 'قيمة الشيك');
  const dueDate = assertIsoDate(input?.dueDate, 'تاريخ الاستحقاق');
  const issueDate = input?.issueDate ? assertIsoDate(input.issueDate, 'تاريخ الإصدار') : null;
  const partyId = input?.partyId ? String(input.partyId) : null;
  if (partyId && !db.prepare('SELECT id FROM parties WHERE id = ?').get(partyId)) throw new UserFacingError('الطرف غير موجود');
  const id = crypto.randomUUID();
  const docNumber = nextDocNumber(db, direction === 'incoming' ? 'check_in' : 'check_out');
  const status = direction === 'incoming' ? 'received' : 'issued';
  db.prepare(`
    INSERT INTO checks (id, doc_number, check_number, bank_name, direction, party_id, amount, issue_date, due_date, status, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, docNumber, optionalText(input?.checkNumber, 40), optionalText(input?.bankName, 80), direction, partyId,
    amount, issueDate, dueDate, status, optionalText(input?.description, 300), userId);
  audit(db, { userId, action: 'create', module: 'treasury', entityId: id, entityType: 'check', details: { docNumber, amount } });
  return { id, docNumber };
}

function updateCheckStatus(db, userId, checkId, status) {
  const check = db.prepare('SELECT id, direction, status FROM checks WHERE id = ?').get(String(checkId ?? ''));
  if (!check) throw new UserFacingError('الشيك غير موجود');
  const allowed = CHECK_STATUS_BY_DIRECTION[check.direction].next[check.status] ?? [];
  if (!allowed.includes(status)) throw new UserFacingError('لا يمكن تغيير حالة الشيك إلى هذه الحالة');
  db.prepare('UPDATE checks SET status = ? WHERE id = ?').run(status, check.id);
  audit(db, { userId, action: 'update', module: 'treasury', entityId: check.id, entityType: 'check', details: { status } });
}

module.exports = {
  listCashboxes,
  createCashbox,
  cashStatement,
  listTransfers,
  createTransfer,
  updateTransferStatus,
  listChecks,
  createCheck,
  updateCheckStatus,
  requireActiveCashbox,
  cashboxBalance,
  insertCashTransaction,
};
