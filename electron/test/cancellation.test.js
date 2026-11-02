const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const treasury = require('../src/services/treasuryService');
const expenses = require('../src/services/expenseService');
const accounting = require('../src/services/accountingService');

let tmpDir;
let db;
let userId;
let cashboxId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-cancel-'));
  db = openDatabase(tmpDir).db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
  cashboxId = treasury.createCashbox(db, userId, { name: 'الرئيسية', openingBalance: 100000, date: '2024-01-01' }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const balanceOf = () => treasury.listCashboxes(db).find((b) => b.id === cashboxId).balance;
const accountBalance = (accountId) => {
  const row = accounting.trialBalance(db).rows.find((r) => r.id === accountId);
  return row ? row.debit - row.credit : 0;
};

test('cancelling an expense restores cash and its category balance, and keeps the books balanced', () => {
  const expense = expenses.createExpense(db, userId, {
    date: '2024-02-01', categoryId: 'ec_feed', amount: 25000, cashboxId, description: 'علف',
  });
  const result = expenses.cancelExpense(db, userId, { expenseId: expense.id, date: '2024-02-03' });

  assert.equal(balanceOf(), 100000);
  assert.equal(accountBalance('acc_feed'), 0);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
  assert.match(result.reversalEntryNumber, /^JV-/);

  const listed = expenses.listExpenses(db).find((row) => row.id === expense.id);
  assert.ok(listed.cancelled_at);
  const original = db.prepare('SELECT status FROM journal_entries WHERE reference_type = ? AND reference_id = ?')
    .get('expense', expense.id);
  assert.equal(original.status, 'reversed');
  const cashRows = db.prepare('SELECT direction, amount FROM cash_transactions WHERE source_id = ? ORDER BY rowid').all(expense.id);
  assert.deepEqual(cashRows.map((row) => row.direction), ['out', 'in']);
});

test('a cancelled expense cannot be cancelled twice', () => {
  const expense = expenses.createExpense(db, userId, {
    date: '2024-02-01', categoryId: 'ec_feed', amount: 25000, cashboxId,
  });
  expenses.cancelExpense(db, userId, { expenseId: expense.id, date: '2024-02-03' });
  assert.throws(
    () => expenses.cancelExpense(db, userId, { expenseId: expense.id, date: '2024-02-04' }),
    UserFacingError,
  );
  assert.equal(balanceOf(), 100000);
});

test('cancelling an income is refused when the cashbox cannot cover the reversal', () => {
  const incomeCategory = expenses.listIncomeCategories(db)[0];
  const income = expenses.createIncome(db, userId, {
    date: '2024-02-01', categoryId: incomeCategory.id, amount: 30000, cashboxId,
  });
  expenses.createExpense(db, userId, {
    date: '2024-02-02', categoryId: 'ec_feed', amount: 105000, cashboxId,
  });
  assert.equal(balanceOf(), 25000);
  assert.throws(
    () => expenses.cancelIncome(db, userId, { incomeId: income.id, date: '2024-02-03' }),
    UserFacingError,
  );
  assert.equal(balanceOf(), 25000);
});

test('cancelling an income with enough cash reverses it and leaves the books balanced', () => {
  const incomeCategory = expenses.listIncomeCategories(db)[0];
  const income = expenses.createIncome(db, userId, {
    date: '2024-02-01', categoryId: incomeCategory.id, amount: 30000, cashboxId,
  });
  assert.equal(balanceOf(), 130000);
  expenses.cancelIncome(db, userId, { incomeId: income.id, date: '2024-02-03' });
  assert.equal(balanceOf(), 100000);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
  assert.ok(expenses.listIncomes(db).find((row) => row.id === income.id).cancelled_at);
});
