const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const accounting = require('../src/services/accountingService');
const { postJournalEntry } = require('../src/domain/postingEngine');

let tmpDir;
let database;
let db;
let userId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-acct-'));
  database = openDatabase(tmpDir);
  db = database.db;
  const auth = createAuthService(db);
  const owner = await auth.setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function expectUserError(fn, message) {
  assert.throws(fn, (error) => error instanceof UserFacingError && error.message === message);
}

function post(date, lines, extra = {}) {
  return postJournalEntry(db, { date, description: 'test', lines, userId, ...extra });
}

test('balanced entry posts and unbalanced entry is rejected', () => {
  post('2024-03-01', [
    { accountId: 'acc_cash', debit: 10000 },
    { accountId: 'acc_sales', credit: 10000 },
  ]);
  expectUserError(() => post('2024-03-01', [
    { accountId: 'acc_cash', debit: 10000 },
    { accountId: 'acc_sales', credit: 9999 },
  ]), 'القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن');
});

test('a line must carry either debit or credit, not both or neither', () => {
  expectUserError(() => post('2024-03-01', [
    { accountId: 'acc_cash', debit: 500, credit: 500 },
    { accountId: 'acc_sales', credit: 0 },
  ]), 'كل سطر يجب أن يحتوي مدينًا أو دائنًا فقط');
});

test('posting into a closed fiscal period is rejected', () => {
  accounting.createFiscalPeriod(db, userId, { name: 'Q1', startDate: '2024-01-01', endDate: '2024-03-31' });
  const period = accounting.listFiscalPeriods(db)[0];
  accounting.closeFiscalPeriod(db, userId, period.id);
  expectUserError(() => post('2024-02-10', [
    { accountId: 'acc_cash', debit: 100 },
    { accountId: 'acc_sales', credit: 100 },
  ]), 'الفترة المحاسبية لهذا التاريخ مغلقة');
});

test('overlapping fiscal periods are rejected', () => {
  accounting.createFiscalPeriod(db, userId, { name: 'Y', startDate: '2024-01-01', endDate: '2024-12-31' });
  expectUserError(() => accounting.createFiscalPeriod(db, userId, { name: 'Q1', startDate: '2024-03-01', endDate: '2024-03-31' }),
    'تتداخل هذه الفترة مع فترة موجودة');
});

test('posted journal lines cannot be edited or deleted', () => {
  const entry = post('2024-03-01', [
    { accountId: 'acc_cash', debit: 300 },
    { accountId: 'acc_sales', credit: 300 },
  ]);
  assert.throws(() => db.prepare('UPDATE journal_lines SET debit = 999 WHERE entry_id = ?').run(entry.id));
  assert.throws(() => db.prepare('DELETE FROM journal_lines WHERE entry_id = ?').run(entry.id));
  assert.throws(() => db.prepare('DELETE FROM journal_entries WHERE id = ?').run(entry.id));
});

test('reversing a manual entry posts a mirror entry and marks the original reversed', () => {
  const entry = accounting.createManualJournalEntry(db, userId, {
    date: '2024-03-02',
    description: 'قيد يدوي',
    lines: [
      { accountId: 'acc_feed', debit: 2500 },
      { accountId: 'acc_cash', credit: 2500 },
    ],
  });
  accounting.reverseEntry(db, userId, entry.id, '2024-03-03');
  const original = db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(entry.id);
  assert.equal(original.status, 'reversed');
  const feed = accounting.generalLedger(db, { accountId: 'acc_feed' });
  assert.equal(feed.closing, 0);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
});

test('a reversal entry cannot be reversed again', () => {
  const entry = accounting.createManualJournalEntry(db, userId, {
    date: '2024-03-02',
    description: 'قيد',
    lines: [
      { accountId: 'acc_feed', debit: 100 },
      { accountId: 'acc_cash', credit: 100 },
    ],
  });
  const reversal = accounting.reverseEntry(db, userId, entry.id, '2024-03-03');
  expectUserError(() => accounting.reverseEntry(db, userId, reversal.id, '2024-03-04'), 'لا يمكن عكس قيد عكسي');
});

test('opening balance is recorded once and keeps the trial balance equal', () => {
  accounting.setOpeningBalance(db, userId, { accountId: 'acc_bank', debit: 500000, date: '2024-01-01' });
  expectUserError(() => accounting.setOpeningBalance(db, userId, { accountId: 'acc_bank', debit: 1, date: '2024-01-01' }),
    'يوجد رصيد افتتاحي مسجل لهذا الحساب بالفعل');
  const tb = accounting.trialBalance(db);
  assert.equal(tb.totalDebit, 500000);
  assert.equal(tb.totalCredit, 500000);
  assert.equal(tb.isBalanced, true);
  assert.equal(accounting.listOpeningBalances(db).length, 1);
});

test('general ledger shows opening balance carried into the period', () => {
  accounting.setOpeningBalance(db, userId, { accountId: 'acc_bank', debit: 10000, date: '2023-12-31' });
  post('2024-01-05', [
    { accountId: 'acc_bank', debit: 2000 },
    { accountId: 'acc_sales', credit: 2000 },
  ]);
  post('2024-01-06', [
    { accountId: 'acc_bank', credit: 500 },
    { accountId: 'acc_feed', debit: 500 },
  ]);
  const ledger = accounting.generalLedger(db, { accountId: 'acc_bank', dateFrom: '2024-01-01', dateTo: '2024-01-31' });
  assert.equal(ledger.opening, 10000);
  assert.equal(ledger.rows.length, 2);
  assert.equal(ledger.closing, 11500);
});

test('profit and loss and balance sheet agree on net profit', () => {
  accounting.setOpeningBalance(db, userId, { accountId: 'acc_bank', debit: 100000, date: '2023-12-31' });
  post('2024-02-01', [
    { accountId: 'acc_cash', debit: 30000 },
    { accountId: 'acc_sales', credit: 30000 },
  ]);
  post('2024-02-02', [
    { accountId: 'acc_feed', debit: 12000 },
    { accountId: 'acc_cash', credit: 12000 },
  ]);
  const pl = accounting.profitAndLoss(db, { dateFrom: '2024-01-01', dateTo: '2024-12-31' });
  assert.equal(pl.revenue, 30000);
  assert.equal(pl.expenses, 12000);
  assert.equal(pl.netProfit, 18000);
  const bs = accounting.balanceSheet(db, { asOf: '2024-12-31' });
  assert.equal(bs.totalAssets, 118000);
  assert.equal(bs.currentProfit, 18000);
  assert.equal(bs.isBalanced, true);
});

test('account codes must be unique and numeric', () => {
  accounting.createAccount(db, userId, { code: '530', name: 'تجربة', type: 'expense' });
  expectUserError(() => accounting.createAccount(db, userId, { code: '530', name: 'مكرر', type: 'expense' }),
    'كود الحساب مستخدم بالفعل');
  expectUserError(() => accounting.createAccount(db, userId, { code: 'A1', name: 'خطأ', type: 'expense' }),
    'كود الحساب يجب أن يحتوي أرقامًا فقط');
});
