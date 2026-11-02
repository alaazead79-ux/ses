const { handleSafely } = require('./handleSafely');
const expenses = require('../services/expenseService');
const payroll = require('../services/payrollService');
const treasury = require('../services/treasuryService');
const backups = require('../services/backupService');
const { dashboardSummary } = require('../services/dashboardService');

// كل قناة تستدعي دالة خدمة واحدة بعد التحقق من صلاحية محددة. المعرّف يأتي من الجلسة فقط
function farmChannels() {
  return [
    ['expenses:categories', 'expenses.view', (db) => ({
      expense: expenses.listExpenseCategories(db),
      income: expenses.listIncomeCategories(db),
    })],
    ['expenses:list', 'expenses.view', (db, _uid, args) => expenses.listExpenses(db, args)],
    ['expenses:create', 'expenses.add', (db, uid, input) => expenses.createExpense(db, uid, input)],
    ['incomes:list', 'expenses.view', (db, _uid, args) => expenses.listIncomes(db, args)],
    ['incomes:create', 'expenses.add', (db, uid, input) => expenses.createIncome(db, uid, input)],
    ['expenses:cancel', 'expenses.edit', (db, uid, input) => expenses.cancelExpense(db, uid, input)],
    ['incomes:cancel', 'expenses.edit', (db, uid, input) => expenses.cancelIncome(db, uid, input)],

    ['treasury:cashboxes', 'treasury.view', (db) => treasury.listCashboxes(db)],
    ['treasury:createCashbox', 'treasury.add', (db, uid, input) => treasury.createCashbox(db, uid, input)],
    ['treasury:statement', 'treasury.view', (db, _uid, args) => treasury.cashStatement(db, args)],
    ['transfers:list', 'transfers.view', (db) => treasury.listTransfers(db)],
    ['transfers:create', 'transfers.add', (db, uid, input) => treasury.createTransfer(db, uid, input)],
    ['checks:list', 'checks.view', (db) => treasury.listChecks(db)],
    ['checks:create', 'checks.add', (db, uid, input) => treasury.createCheck(db, uid, input)],

    ['employees:list', 'employees.view', (db) => payroll.listEmployees(db)],
    ['employees:create', 'employees.add', (db, uid, input) => payroll.createEmployee(db, uid, input)],
    ['employees:attendance', 'employees.view', (db, _uid, args) => payroll.listAttendance(db, args)],
    ['employees:recordAttendance', 'employees.edit', (db, uid, input) => payroll.recordAttendance(db, uid, input)],
    ['employees:advances', 'employees.view', (db, _uid, args) => payroll.listAdvances(db, args)],
    ['employees:createAdvance', 'employees.add', (db, uid, input) => payroll.createAdvance(db, uid, input)],
    ['employees:salaries', 'employees.view', (db, _uid, args) => payroll.listSalaries(db, args)],
    ['employees:createSalary', 'employees.add', (db, uid, input) => payroll.createSalary(db, uid, input)],
    ['employees:paySalary', 'employees.edit', (db, uid, input) => payroll.paySalary(db, uid, input)],

    ['dashboard:summary', 'dashboard.view', (db, _uid, args) => dashboardSummary(db, args)],
  ];
}

function registerFarmHandlers(ipcMain, auth, getDatabase, getBackupDir) {
  for (const [channel, permission, run] of farmChannels()) {
    handleSafely(ipcMain, channel, (key, payload) => {
      const actor = auth.requirePermission(key, permission);
      return run(getDatabase(), actor.id, payload);
    });
  }
  handleSafely(ipcMain, 'backup:list', (key) => {
    auth.requirePermission(key, 'backup.view');
    return backups.listBackups(getBackupDir());
  });
}

module.exports = { registerFarmHandlers };
