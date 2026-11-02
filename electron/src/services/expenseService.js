const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { assertIsoDate, optionalText, toPiastres, allocateByWeights } = require('../domain/money');
const { nextDocNumber, postJournalEntry } = require('../domain/postingEngine');
const { requireActiveCashbox, cashboxBalance, insertCashTransaction } = require('./treasuryService');

const TOTAL_BASIS_POINTS = 10000;

function listExpenseCategories(db) {
  return db.prepare('SELECT id, name, account_id FROM expense_categories WHERE is_active = 1 ORDER BY sort_order, name').all();
}

function listIncomeCategories(db) {
  return db.prepare('SELECT id, name, account_id FROM income_categories WHERE is_active = 1 ORDER BY sort_order, name').all();
}

function requireCategory(db, table, categoryId) {
  const category = db.prepare(`SELECT id, account_id FROM ${table} WHERE id = ? AND is_active = 1`).get(String(categoryId ?? ''));
  if (!category || !category.account_id) throw new UserFacingError('التصنيف غير موجود');
  return category;
}

function requireActivity(db, activityId) {
  if (!db.prepare('SELECT id FROM activities WHERE id = ? AND is_active = 1').get(String(activityId ?? ''))) {
    throw new UserFacingError('النشاط غير موجود');
  }
  return String(activityId);
}

// نسب التوزيع بنقاط أساس (10000 = 100%)، ومجموعها يجب أن يساوي 100% بالضبط
function normalizeDistributions(db, distributions) {
  if (!Array.isArray(distributions) || distributions.length === 0) return [];
  const seen = new Set();
  const rows = distributions.map((item) => {
    const activityId = requireActivity(db, item?.activityId);
    if (seen.has(activityId)) throw new UserFacingError('لا يمكن تكرار النشاط في التوزيع');
    seen.add(activityId);
    const basisPoints = Number(item?.basisPoints);
    if (!Number.isInteger(basisPoints) || basisPoints <= 0 || basisPoints > TOTAL_BASIS_POINTS) {
      throw new UserFacingError('نسبة التوزيع غير صالحة');
    }
    return { activityId, basisPoints };
  });
  const total = rows.reduce((sum, row) => sum + row.basisPoints, 0);
  if (total !== TOTAL_BASIS_POINTS) throw new UserFacingError('مجموع نسب التوزيع يجب أن يساوي 100%');
  return rows;
}

// يُسجَّل المصروف بقيد: مدين حساب التصنيف / دائن الخزينة، ويُوزَّع على الأنشطة بنسبها
function createExpense(db, userId, input) {
  const date = assertIsoDate(input?.date);
  const amount = toPiastres(input?.amount, 'المبلغ');
  const category = requireCategory(db, 'expense_categories', input?.categoryId);
  const box = requireActiveCashbox(db, input?.cashboxId);
  const description = optionalText(input?.description, 300);
  const distributions = normalizeDistributions(db, input?.distributions);
  const activityId = distributions.length > 0 || !input?.activityId ? null : requireActivity(db, input.activityId);

  return db.transaction(() => {
    if (cashboxBalance(db, box.id) < amount) throw new UserFacingError('رصيد الخزينة غير كافٍ لتسجيل هذا المصروف');
    const id = crypto.randomUUID();
    const docNumber = nextDocNumber(db, 'expense');
    const journalEntryId = postJournalEntry(db, {
      date,
      description: description ?? `مصروف ${docNumber}`,
      referenceType: 'expense',
      referenceId: id,
      activityId,
      userId,
      lines: [
        { accountId: category.account_id, debit: amount, description },
        { accountId: box.account_id, credit: amount, description },
      ],
    }).id;
    db.prepare(`
      INSERT INTO expenses (id, doc_number, date, category_id, account_id, amount, activity_id, payment_method,
        cashbox_id, description, is_shared, journal_entry_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?)
    `).run(id, docNumber, date, String(input.categoryId), category.account_id, amount,
      activityId, box.id, description, distributions.length > 0 ? 1 : 0, journalEntryId, userId);
    if (distributions.length > 0) {
      const shares = allocateByWeights(amount, distributions.map((row) => row.basisPoints));
      const insertShare = db.prepare(`
        INSERT INTO expense_distributions (id, expense_id, activity_id, basis_points, amount) VALUES (?, ?, ?, ?, ?)
      `);
      distributions.forEach((row, index) => {
        insertShare.run(crypto.randomUUID(), id, row.activityId, row.basisPoints, shares[index]);
      });
    }
    insertCashTransaction(db, {
      docNumber, date, type: 'payment', direction: 'out', cashboxId: box.id, amount,
      sourceType: 'expense', sourceId: id, description, journalEntryId, userId,
    });
    audit(db, { userId, action: 'create', module: 'expenses', entityId: id, entityType: 'expense', details: { docNumber, amount } });
    return { id, docNumber, amount };
  })();
}

// يُسجَّل الإيراد بقيد: مدين الخزينة / دائن حساب التصنيف
function createIncome(db, userId, input) {
  const date = assertIsoDate(input?.date);
  const amount = toPiastres(input?.amount, 'المبلغ');
  const category = requireCategory(db, 'income_categories', input?.categoryId);
  const box = requireActiveCashbox(db, input?.cashboxId);
  const description = optionalText(input?.description, 300);
  const activityId = input?.activityId ? requireActivity(db, input.activityId) : null;

  return db.transaction(() => {
    const id = crypto.randomUUID();
    const docNumber = nextDocNumber(db, 'income');
    const journalEntryId = postJournalEntry(db, {
      date,
      description: description ?? `إيراد ${docNumber}`,
      referenceType: 'income',
      referenceId: id,
      activityId,
      userId,
      lines: [
        { accountId: box.account_id, debit: amount, description },
        { accountId: category.account_id, credit: amount, description },
      ],
    }).id;
    db.prepare(`
      INSERT INTO incomes (id, doc_number, date, category_id, account_id, amount, activity_id, payment_method,
        cashbox_id, description, journal_entry_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, ?)
    `).run(id, docNumber, date, String(input.categoryId), category.account_id, amount, activityId,
      box.id, description, journalEntryId, userId);
    insertCashTransaction(db, {
      docNumber, date, type: 'receipt', direction: 'in', cashboxId: box.id, amount,
      sourceType: 'income', sourceId: id, description, journalEntryId, userId,
    });
    audit(db, { userId, action: 'create', module: 'expenses', entityId: id, entityType: 'income', details: { docNumber, amount } });
    return { id, docNumber, amount };
  })();
}

function listExpenses(db, { dateFrom = null, dateTo = null } = {}) {
  const conditions = [];
  const params = [];
  if (dateFrom) { conditions.push('e.date >= ?'); params.push(assertIsoDate(dateFrom)); }
  if (dateTo) { conditions.push('e.date <= ?'); params.push(assertIsoDate(dateTo)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT e.id, e.doc_number, e.date, e.amount, e.description, e.is_shared,
      c.name AS category_name, a.name AS activity_name, b.name AS cashbox_name
    FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN activities a ON a.id = e.activity_id
    LEFT JOIN cashboxes b ON b.id = e.cashbox_id
    ${where} ORDER BY e.date DESC, e.doc_number DESC LIMIT 500
  `).all(...params);
}

function listIncomes(db, { dateFrom = null, dateTo = null } = {}) {
  const conditions = [];
  const params = [];
  if (dateFrom) { conditions.push('i.date >= ?'); params.push(assertIsoDate(dateFrom)); }
  if (dateTo) { conditions.push('i.date <= ?'); params.push(assertIsoDate(dateTo)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT i.id, i.doc_number, i.date, i.amount, i.description,
      c.name AS category_name, a.name AS activity_name, b.name AS cashbox_name
    FROM incomes i
    LEFT JOIN income_categories c ON c.id = i.category_id
    LEFT JOIN activities a ON a.id = i.activity_id
    LEFT JOIN cashboxes b ON b.id = i.cashbox_id
    ${where} ORDER BY i.date DESC, i.doc_number DESC LIMIT 500
  `).all(...params);
}

function expenseDistribution(db, expenseId) {
  return db.prepare(`
    SELECT d.activity_id, a.name AS activity_name, d.basis_points, d.amount
    FROM expense_distributions d JOIN activities a ON a.id = d.activity_id
    WHERE d.expense_id = ? ORDER BY a.sort_order, a.name
  `).all(String(expenseId ?? ''));
}

module.exports = {
  listExpenseCategories,
  listIncomeCategories,
  createExpense,
  createIncome,
  listExpenses,
  listIncomes,
  expenseDistribution,
};
