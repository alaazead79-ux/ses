const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const inventory = require('../src/services/inventoryService');

let tmpDir;
let db;
let userId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-inv-'));
  db = openDatabase(tmpDir).db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function stockOf(productId) {
  return db.prepare('SELECT quantity_milli AS q, total_value AS v FROM products WHERE id = ?').get(productId);
}

test('receiving stock at different prices uses the weighted average on issue', () => {
  const { id } = inventory.createProduct(db, userId, { name: 'علف', unit: 'كيس' });
  inventory.receiveStock(db, { date: '2024-01-01', productId: id, quantityMilli: 10000, totalCost: 50000, userId });
  inventory.receiveStock(db, { date: '2024-01-02', productId: id, quantityMilli: 10000, totalCost: 70000, userId });
  const issued = inventory.issueStock(db, { date: '2024-01-03', productId: id, quantityMilli: 5000, userId });
  assert.equal(issued.totalCost, 30000);
  assert.deepEqual(stockOf(id), { q: 15000, v: 90000 });
});

test('issuing more than is on hand is rejected and leaves stock unchanged', () => {
  const { id } = inventory.createProduct(db, userId, { name: 'دواء', unit: 'عبوة' });
  inventory.receiveStock(db, { date: '2024-01-01', productId: id, quantityMilli: 2000, totalCost: 4000, userId });
  assert.throws(() => inventory.issueStock(db, { date: '2024-01-02', productId: id, quantityMilli: 3000, userId }),
    (e) => e instanceof UserFacingError);
  assert.deepEqual(stockOf(id), { q: 2000, v: 4000 });
});

test('emptying a product clears its value exactly, with no rounding residue', () => {
  const { id } = inventory.createProduct(db, userId, { name: 'نخالة', unit: 'كغ' });
  inventory.receiveStock(db, { date: '2024-01-01', productId: id, quantityMilli: 3000, totalCost: 1000, userId });
  inventory.receiveStock(db, { date: '2024-01-01', productId: id, quantityMilli: 7000, totalCost: 2001, userId });
  inventory.issueStock(db, { date: '2024-01-02', productId: id, quantityMilli: 4000, userId });
  inventory.issueStock(db, { date: '2024-01-03', productId: id, quantityMilli: 6000, userId });
  assert.deepEqual(stockOf(id), { q: 0, v: 0 });
});

test('every stock change writes a movement with the running balance', () => {
  const { id } = inventory.createProduct(db, userId, { name: 'ملح', unit: 'كيس' });
  inventory.receiveStock(db, { date: '2024-01-01', productId: id, quantityMilli: 1000, totalCost: 500, userId });
  inventory.issueStock(db, { date: '2024-01-02', productId: id, quantityMilli: 400, userId });
  const moves = inventory.listStockMovements(db, id);
  assert.equal(moves.length, 2);
  assert.equal(moves[1].quantity_after_milli, 600);
  assert.equal(moves[1].value_after, 300);
});

test('products at or below the reorder level are flagged low stock', () => {
  const { id } = inventory.createProduct(db, userId, { name: 'علاج', unit: 'عبوة', reorderLevel: 5 });
  inventory.receiveStock(db, { date: '2024-01-01', productId: id, quantityMilli: 5000, totalCost: 1000, userId });
  assert.equal(inventory.listProducts(db).find((p) => p.id === id).is_low_stock, true);
});

test('duplicate product SKU is rejected', () => {
  inventory.createProduct(db, userId, { name: 'أ', sku: 'SKU-1' });
  assert.throws(() => inventory.createProduct(db, userId, { name: 'ب', sku: 'SKU-1' }),
    (e) => e instanceof UserFacingError && e.message === 'رمز الصنف مستخدم بالفعل');
});
