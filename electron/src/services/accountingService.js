const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { assertIsoDate, requireText, optionalText, toPiastres } = require('../domain/money');
const { postJournalEntry, reverseManualJournalEntry } = require('../domain/postingEngine');

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const OPENING_OFFSET_ACCOUNT = 'acc_capital';
const POSTED_STATUSES = "('posted','reversed')";

function listAccounts(db) {
  return db.prepare(`
    SELECT a.id, a.code, a.name, a.type, a.parent_id, a.is_active, a.is_system,
      COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS balance
    FROM accounts a
    LEFT JOIN journal_lines l ON l.account_id = a.id
    LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status IN ${POSTED_STATUSES}
    GROUP BY a.id ORDER BY a.code
  `).all().map((row) => ({ ...row, is_active: row.is_active === 1, is_system: row.is_system === 1 }));
}

function createAccount(db, userId, input) {
  const code = requireText(input?.code, 'كود الحساب', 20);
  if (!/^[0-9.]+$/.test(code)) throw new UserFacingError('كود الحساب يجب أن يحتوي أرقامًا فقط');
  const name = requireText(input?.name, 'اسم الحساب', 120);
  const type = input?.type;
  if (!ACCOUNT_TYPES.includes(type)) throw new UserFacingError('نوع الحساب غير صالح');
  const parentId = input?.parentId ? String(input.parentId) : null;
  if (parentId && !db.prepare('SELECT id FROM accounts WHERE id = ?').get(parentId)) {
    throw new UserFacingError('الحساب الأب غير موجود');
  }
  if (db.prepare('SELECT id FROM accounts WHERE code = ?').get(code)) {
    throw new UserFacingError('كود الحساب مستخدم بالفعل');
  }
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO accounts (id, code, name, type, parent_id) VALUES (?, ?, ?, ?, ?)
  `).run(id, code, name, type, parentId);
  audit(db, { userId, action: 'create', module: 'accounting', entityId: id, entityType: 'account', details: { code, name } });
  return { id };
}

function listJournalEntries(db, { limit = 50, offset = 0, dateFrom, dateTo } = {}) {
  const conditions = ['1 = 1'];
  const params = [];
  if (dateFrom) { conditions.push('e.date >= ?'); params.push(assertIsoDate(dateFrom)); }
  if (dateTo) { conditions.push('e.date <= ?'); params.push(assertIsoDate(dateTo)); }
  const entries = db.prepare(`
    SELECT e.id, e.entry_number, e.date, e.description, e.reference_type, e.reference_id, e.activity_id, e.status
    FROM journal_entries e
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.date DESC, e.entry_number DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));

  const linesStmt = db.prepare(`
    SELECT l.id, l.account_id, l.debit, l.credit, l.description, a.code AS account_code, a.name AS account_name
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.entry_id = ? ORDER BY l.rowid
  `);
  return entries.map((entry) => ({ ...entry, lines: linesStmt.all(entry.id) }));
}

function createManualJournalEntry(db, userId, input) {
  const date = assertIsoDate(input?.date);
  const description = requireText(input?.description, 'البيان', 300);
  const lines = (input?.lines ?? []).map((line) => ({
    accountId: String(line?.accountId ?? ''),
    debit: toPiastres(line?.debit ?? 0, 'المدين', { allowZero: true }),
    credit: toPiastres(line?.credit ?? 0, 'الدائن', { allowZero: true }),
    description: optionalText(line?.description, 200),
  }));
  const activityId = input?.activityId ? String(input.activityId) : null;
  if (activityId && !db.prepare('SELECT id FROM activities WHERE id = ?').get(activityId)) {
    throw new UserFacingError('النشاط غير موجود');
  }
  return db.transaction(() => {
    const result = postJournalEntry(db, {
      date, description, referenceType: 'manual', activityId, lines, userId,
    });
    audit(db, { userId, action: 'create', module: 'accounting', entityId: result.id, entityType: 'journal_entry', details: { entryNumber: result.entryNumber } });
    return result;
  })();
}

function accountBalancesBetween(db, { dateFrom = null, dateTo = null, activityId = null, beforeDate = null } = {}) {
  const conditions = [`e.status IN ${POSTED_STATUSES}`];
  const params = [];
  if (dateFrom) { conditions.push('e.date >= ?'); params.push(dateFrom); }
  if (dateTo) { conditions.push('e.date <= ?'); params.push(dateTo); }
  if (beforeDate) { conditions.push('e.date < ?'); params.push(beforeDate); }
  if (activityId) { conditions.push('e.activity_id = ?'); params.push(activityId); }
  return db.prepare(`
    SELECT a.id, a.code, a.name, a.type,
      COALESCE(SUM(l.debit), 0) AS debit,
      COALESCE(SUM(l.credit), 0) AS credit
    FROM accounts a
    LEFT JOIN journal_lines l ON l.account_id = a.id
    LEFT JOIN journal_entries e ON e.id = l.entry_id AND ${conditions.join(' AND ')}
    GROUP BY a.id ORDER BY a.code
  `).all(...params);
}

function trialBalance(db, { dateFrom, dateTo } = {}) {
  const rows = accountBalancesBetween(db, {
    dateFrom: dateFrom ? assertIsoDate(dateFrom) : null,
    dateTo: dateTo ? assertIsoDate(dateTo) : null,
  }).filter((row) => row.debit !== 0 || row.credit !== 0);
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  return { rows, totalDebit, totalCredit, isBalanced: totalDebit === totalCredit };
}

function generalLedger(db, { accountId, dateFrom, dateTo }) {
  const account = db.prepare('SELECT id, code, name, type FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new UserFacingError('الحساب غير موجود');
  const from = dateFrom ? assertIsoDate(dateFrom) : null;
  const to = dateTo ? assertIsoDate(dateTo) : null;

  let opening = 0;
  if (from) {
    const row = db.prepare(`
      SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS net
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account_id = ? AND e.status IN ${POSTED_STATUSES} AND e.date < ?
    `).get(accountId, from);
    opening = row.net;
  }

  const conditions = ['l.account_id = ?', `e.status IN ${POSTED_STATUSES}`];
  const params = [accountId];
  if (from) { conditions.push('e.date >= ?'); params.push(from); }
  if (to) { conditions.push('e.date <= ?'); params.push(to); }
  const rows = db.prepare(`
    SELECT e.date, e.entry_number, e.description, l.debit, l.credit
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.date, e.entry_number, l.rowid
  `).all(...params);

  let balance = opening;
  const ledgerRows = rows.map((row) => {
    balance += row.debit - row.credit;
    return { ...row, balance };
  });
  return { account, opening, rows: ledgerRows, closing: balance };
}

function listFiscalPeriods(db) {
  return db.prepare('SELECT id, name, start_date, end_date, is_closed, closed_at FROM fiscal_periods ORDER BY start_date DESC')
    .all().map((row) => ({ ...row, is_closed: row.is_closed === 1 }));
}

function createFiscalPeriod(db, userId, input) {
  const name = requireText(input?.name, 'اسم الفترة', 80);
  const startDate = assertIsoDate(input?.startDate, 'تاريخ البداية');
  const endDate = assertIsoDate(input?.endDate, 'تاريخ النهاية');
  if (endDate <= startDate) throw new UserFacingError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
  const overlap = db.prepare('SELECT id FROM fiscal_periods WHERE start_date <= ? AND end_date >= ?').get(endDate, startDate);
  if (overlap) throw new UserFacingError('تتداخل هذه الفترة مع فترة موجودة');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO fiscal_periods (id, name, start_date, end_date) VALUES (?, ?, ?, ?)')
    .run(id, name, startDate, endDate);
  audit(db, { userId, action: 'create', module: 'accounting', entityId: id, entityType: 'fiscal_period', details: { name } });
  return { id };
}

function closeFiscalPeriod(db, userId, periodId) {
  const period = db.prepare('SELECT id, is_closed FROM fiscal_periods WHERE id = ?').get(periodId);
  if (!period) throw new UserFacingError('الفترة غير موجودة');
  if (period.is_closed === 1) throw new UserFacingError('الفترة مغلقة بالفعل');
  const now = new Date().toISOString();
  db.prepare('UPDATE fiscal_periods SET is_closed = 1, closed_at = ?, closed_by = ? WHERE id = ?').run(now, userId, periodId);
  audit(db, { userId, action: 'close', module: 'accounting', entityId: periodId, entityType: 'fiscal_period' });
}

function setOpeningBalance(db, userId, input) {
  const accountId = String(input?.accountId ?? '');
  const account = db.prepare('SELECT id, type FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new UserFacingError('الحساب غير موجود');
  if (account.id === OPENING_OFFSET_ACCOUNT) throw new UserFacingError('لا يمكن إدخال رصيد افتتاحي على حساب رأس المال');
  if (db.prepare('SELECT id FROM cashboxes WHERE account_id = ?').get(accountId)) {
    throw new UserFacingError('رصيد الخزينة يُدخَل من شاشة الخزينة');
  }
  const date = assertIsoDate(input?.date);
  const debit = toPiastres(input?.debit ?? 0, 'المدين', { allowZero: true });
  const credit = toPiastres(input?.credit ?? 0, 'الدائن', { allowZero: true });
  if ((debit === 0) === (credit === 0)) throw new UserFacingError('أدخل مبلغًا في المدين أو الدائن فقط');

  return db.transaction(() => {
    if (db.prepare('SELECT id FROM opening_balances WHERE account_id = ?').get(accountId)) {
      throw new UserFacingError('يوجد رصيد افتتاحي مسجل لهذا الحساب بالفعل');
    }
    const openingId = crypto.randomUUID();
    const entry = postJournalEntry(db, {
      date,
      description: 'رصيد افتتاحي',
      referenceType: 'opening',
      referenceId: openingId,
      userId,
      lines: [
        { accountId, debit, credit, description: 'رصيد افتتاحي' },
        { accountId: OPENING_OFFSET_ACCOUNT, debit: credit, credit: debit, description: 'مقابل الرصيد الافتتاحي' },
      ],
    });
    db.prepare(`
      INSERT INTO opening_balances (id, account_id, debit, credit, date, journal_entry_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(openingId, accountId, debit, credit, date, entry.id);
    audit(db, { userId, action: 'create', module: 'accounting', entityId: openingId, entityType: 'opening_balance', details: { accountId } });
    return { id: openingId };
  })();
}

function listOpeningBalances(db) {
  return db.prepare(`
    SELECT ob.id, ob.account_id, a.code, a.name, ob.debit, ob.credit, ob.date
    FROM opening_balances ob JOIN accounts a ON a.id = ob.account_id ORDER BY a.code
  `).all();
}

function profitAndLoss(db, { dateFrom, dateTo, activityId = null }) {
  const from = assertIsoDate(dateFrom, 'تاريخ البداية');
  const to = assertIsoDate(dateTo, 'تاريخ النهاية');
  if (to < from) throw new UserFacingError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
  const rows = accountBalancesBetween(db, { dateFrom: from, dateTo: to, activityId: activityId || null })
    .filter((row) => row.type === 'revenue' || row.type === 'expense');
  const lines = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    amount: row.type === 'revenue' ? row.credit - row.debit : row.debit - row.credit,
  })).filter((row) => row.amount !== 0);
  const revenue = lines.filter((l) => l.type === 'revenue').reduce((s, l) => s + l.amount, 0);
  const expenses = lines.filter((l) => l.type === 'expense').reduce((s, l) => s + l.amount, 0);
  return { from, to, activityId: activityId || null, lines, revenue, expenses, netProfit: revenue - expenses };
}

function balanceSheet(db, { asOf }) {
  const date = assertIsoDate(asOf, 'تاريخ الميزانية');
  const rows = accountBalancesBetween(db, { dateTo: date });
  const sumType = (type, sign) => rows
    .filter((row) => row.type === type)
    .map((row) => ({ id: row.id, code: row.code, name: row.name, amount: sign * (row.debit - row.credit) }))
    .filter((row) => row.amount !== 0);
  const assets = sumType('asset', 1);
  const liabilities = sumType('liability', -1);
  const equityAccounts = sumType('equity', -1);
  const currentProfit = rows
    .filter((row) => row.type === 'revenue' || row.type === 'expense')
    .reduce((sum, row) => sum + (row.type === 'revenue' ? row.credit - row.debit : -(row.debit - row.credit)), 0);
  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equityAccounts.reduce((s, r) => s + r.amount, 0) + currentProfit;
  return {
    asOf: date,
    assets,
    liabilities,
    equity: equityAccounts,
    currentProfit,
    totalAssets,
    totalLiabilities,
    totalEquity,
    isBalanced: totalAssets === totalLiabilities + totalEquity,
  };
}

function reverseEntry(db, userId, entryId, date) {
  return reverseManualJournalEntry(db, { entryId: String(entryId), date: assertIsoDate(date), userId });
}

function listActivities(db) {
  return db.prepare('SELECT id, name, description, is_active, sort_order FROM activities ORDER BY sort_order, name')
    .all().map((row) => ({ ...row, is_active: row.is_active === 1 }));
}

module.exports = {
  ACCOUNT_TYPES,
  listAccounts,
  createAccount,
  listJournalEntries,
  createManualJournalEntry,
  reverseEntry,
  trialBalance,
  generalLedger,
  listFiscalPeriods,
  createFiscalPeriod,
  closeFiscalPeriod,
  setOpeningBalance,
  listOpeningBalances,
  profitAndLoss,
  balanceSheet,
  listActivities,
};
