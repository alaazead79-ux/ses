const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const treasury = require('../src/services/treasuryService');
const accounting = require('../src/services/accountingService');
const payroll = require('../src/services/payrollService');

let tmpDir;
let db;
let userId;
let cashboxId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-payroll-'));
  db = openDatabase(tmpDir).db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
  cashboxId = treasury.createCashbox(db, userId, { name: 'الرئيسية', openingBalance: 200000, date: '2024-01-01' }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const cashBalance = () => treasury.listCashboxes(db).find((b) => b.id === cashboxId).balance;
const accountBalance = (accountId) => {
  const row = accounting.trialBalance(db).rows.find((r) => r.id === accountId);
  return row ? row.debit - row.credit : 0;
};

test('a monthly salary paid now deducts an advance installment and keeps the books balanced', () => {
  const emp = payroll.createEmployee(db, userId, { name: 'أحمد', baseSalary: 50000, salaryType: 'monthly' });
  payroll.createAdvance(db, userId, { employeeId: emp.id, date: '2024-02-10', amount: 20000, cashboxId, installmentAmount: 5000 });
  assert.equal(cashBalance(), 180000);

  const salary = payroll.createSalary(db, userId, { employeeId: emp.id, month: '2024-03', date: '2024-03-31', cashboxId });
  assert.equal(salary.advanceDeduct, 5000);
  assert.equal(salary.net, 45000);
  assert.equal(cashBalance(), 135000);
  assert.equal(accountBalance('acc_advances_emp'), 15000);
  assert.equal(accountBalance('acc_salaries'), 50000);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
  assert.equal(payroll.listAdvances(db)[0].remaining, 15000);
});

test('an unpaid salary is booked to salaries payable and paid later from a cashbox', () => {
  const emp = payroll.createEmployee(db, userId, { name: 'سالم', baseSalary: 30000 });
  const salary = payroll.createSalary(db, userId, { employeeId: emp.id, month: '2024-03', date: '2024-03-31' });
  assert.equal(accountBalance('acc_salaries_pay'), -30000);
  assert.equal(payroll.listSalaries(db, { month: '2024-03' })[0].status, 'pending');

  payroll.paySalary(db, userId, { salaryId: salary.id, date: '2024-04-02', cashboxId });
  assert.equal(accountBalance('acc_salaries_pay'), 0);
  assert.equal(cashBalance(), 170000);
  assert.equal(payroll.listSalaries(db, { month: '2024-03' })[0].status, 'paid');
  assert.equal(accounting.trialBalance(db).isBalanced, true);
});

test('a daily salary counts present and late days only', () => {
  const emp = payroll.createEmployee(db, userId, { name: 'محمد', baseSalary: 1000, salaryType: 'daily' });
  for (const [date, status] of [['2024-03-01', 'present'], ['2024-03-02', 'late'], ['2024-03-03', 'absent'], ['2024-03-04', 'present']]) {
    payroll.recordAttendance(db, userId, { employeeId: emp.id, date, status });
  }
  const salary = payroll.createSalary(db, userId, { employeeId: emp.id, month: '2024-03', date: '2024-03-31' });
  assert.equal(salary.net, 3000);
});

test('a second salary for the same employee and month is refused', () => {
  const emp = payroll.createEmployee(db, userId, { name: 'خالد', baseSalary: 10000 });
  payroll.createSalary(db, userId, { employeeId: emp.id, month: '2024-03', date: '2024-03-31' });
  assert.throws(() => payroll.createSalary(db, userId, { employeeId: emp.id, month: '2024-03', date: '2024-03-31' }), UserFacingError);
});

test('an advance larger than the cashbox balance is refused', () => {
  const emp = payroll.createEmployee(db, userId, { name: 'علي', baseSalary: 10000 });
  assert.throws(() => payroll.createAdvance(db, userId, { employeeId: emp.id, date: '2024-02-10', amount: 200001, cashboxId }), UserFacingError);
  assert.equal(cashBalance(), 200000);
});
