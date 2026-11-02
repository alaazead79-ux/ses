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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-expense-'));
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

test('an expense debits its category, credits the cashbox and reduces cash', () => {
  const result = expenses.createExpense(db, userId, {
    date: '2024-02-01', categoryId: 'ec_feed', amount: 25000, cashboxId, description: 'علف',
  });
  assert.equal(result.docNumber, 'EXP-00001');
  assert.equal(balanceOf(), 75000);
  assert.equal(accountBalance('acc_feed'), 25000);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
});

test('an expense larger than the cashbox balance is refused', () => {
  assert.throws(() => expenses.createExpense(db, userId, {
    date: '2024-02-01', categoryId: 'ec_feed', amount: 100001, cashboxId,
  }), UserFacingError);
  assert.equal(balanceOf(), 100000);
});

test('a shared expense is split by basis points with an exact total', () => {
  const result = expenses.createExpense(db, userId, {
    date: '2024-02-01', categoryId: 'ec_utilities', amount: 1000, cashboxId,
    distributions: [
      { activityId: 'fattening', basisPoints: 3333 },
      { activityId: 'dairy', basisPoints: 3333 },
      { activityId: 'breeding', basisPoints: 3334 },
    ],
  });
  const shares = expenses.expenseDistribution(db, result.id).map((row) => row.amount);
  assert.equal(shares.reduce((a, b) => a + b, 0), 1000);
  assert.deepEqual(shares.sort(), [333, 333, 334]);
});

test('distribution percentages must total exactly 100%', () => {
  assert.throws(() => expenses.createExpense(db, userId, {
    date: '2024-02-01', categoryId: 'ec_utilities', amount: 1000, cashboxId,
    distributions: [{ activityId: 'fattening', basisPoints: 5000 }],
  }), UserFacingError);
  assert.equal(balanceOf(), 100000);
});

test('an income debits the cashbox and credits its category', () => {
  expenses.createIncome(db, userId, {
    date: '2024-02-02', categoryId: 'ic_other', amount: 5000, cashboxId, description: 'بيع خردة',
  });
  assert.equal(balanceOf(), 105000);
  assert.equal(accountBalance('acc_other_income'), -5000);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
});

test('expenses and incomes are listed with their document numbers', () => {
  expenses.createExpense(db, userId, { date: '2024-02-01', categoryId: 'ec_fuel', amount: 100, cashboxId });
  expenses.createIncome(db, userId, { date: '2024-02-01', categoryId: 'ic_misc', amount: 200, cashboxId });
  assert.equal(expenses.listExpenses(db)[0].doc_number, 'EXP-00001');
  assert.equal(expenses.listIncomes(db)[0].doc_number, 'INC-00001');
});
