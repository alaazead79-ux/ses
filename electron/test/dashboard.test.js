const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const treasury = require('../src/services/treasuryService');
const expenses = require('../src/services/expenseService');
const inventory = require('../src/services/inventoryService');
const { dashboardSummary } = require('../src/services/dashboardService');

let tmpDir;
let db;
let userId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-dashboard-'));
  db = openDatabase(tmpDir).db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('the dashboard reports cash, stock value, low stock and this month profit', () => {
  const cashboxId = treasury.createCashbox(db, userId, { name: 'الرئيسية', openingBalance: 100000, date: '2024-01-01' }).id;
  expenses.createExpense(db, userId, { date: '2024-03-05', categoryId: 'ec_feed', amount: 20000, cashboxId });
  expenses.createIncome(db, userId, { date: '2024-03-06', categoryId: 'ic_other', amount: 50000, cashboxId });
  const productId = inventory.createProduct(db, userId, { name: 'علف', unit: 'كغ', reorderLevel: 5 }).id;
  inventory.receiveStock(db, { date: '2024-03-01', productId, quantityMilli: 4000, totalCost: 8000, userId });

  const summary = dashboardSummary(db, { asOf: '2024-03-31' });
  assert.equal(summary.cashOnHand, 130000);
  assert.equal(summary.stockValue, 8000);
  assert.equal(summary.lowStockCount, 1);
  assert.equal(summary.monthProfit, 30000);
  assert.equal(summary.receivables, 0);
  assert.equal(summary.payables, 0);
});
