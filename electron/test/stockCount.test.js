const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const inventory = require('../src/services/inventoryService');
const counts = require('../src/services/stockCountService');
const accounting = require('../src/services/accountingService');

let tmpDir;
let db;
let userId;
let productId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-count-'));
  db = openDatabase(tmpDir).db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
  productId = inventory.createProduct(db, userId, { name: 'ذرة', unit: 'كغ' }).id;
  inventory.receiveStock(db, { date: '2024-01-01', productId, quantityMilli: 10000, totalCost: 30000, userId });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const stock = () => db.prepare('SELECT quantity_milli AS q, total_value AS v FROM products WHERE id = ?').get(productId);

test('a shortage is written off to inventory adjustments at average cost', () => {
  const result = counts.recordStockCount(db, userId, {
    date: '2024-02-01', items: [{ productId, countedQuantity: 8 }],
  });
  assert.equal(result.losses, 6000);
  assert.deepEqual(stock(), { q: 8000, v: 24000 });
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_inventory_adj' }).closing, 6000);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
});

test('a surplus is valued at the current average and credited to inventory adjustments', () => {
  const result = counts.recordStockCount(db, userId, {
    date: '2024-02-01', items: [{ productId, countedQuantity: 12 }],
  });
  assert.equal(result.gains, 6000);
  assert.deepEqual(stock(), { q: 12000, v: 36000 });
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_inventory_adj' }).closing, -6000);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
});

test('a count that matches the books changes nothing and posts nothing', () => {
  const before = db.prepare('SELECT COUNT(*) AS c FROM journal_entries').get().c;
  const result = counts.recordStockCount(db, userId, {
    date: '2024-02-01', items: [{ productId, countedQuantity: 10 }],
  });
  assert.equal(result.gains + result.losses, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_entries').get().c, before);
  assert.equal(counts.listStockCounts(db)[0].status, 'completed');
});
