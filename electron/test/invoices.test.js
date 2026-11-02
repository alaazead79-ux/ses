const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const parties = require('../src/services/partyService');
const inventory = require('../src/services/inventoryService');
const accounting = require('../src/services/accountingService');
const invoices = require('../src/services/invoiceService');

let tmpDir;
let db;
let userId;
let customerId;
let supplierId;
let productId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-inv-doc-'));
  db = openDatabase(tmpDir).db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
  customerId = parties.createParty(db, userId, { name: 'عميل', type: 'customer' }).id;
  supplierId = parties.createParty(db, userId, { name: 'مورد', type: 'supplier' }).id;
  productId = inventory.createProduct(db, userId, { name: 'علف مركز', unit: 'كيس' }).id;
  inventory.receiveStock(db, { date: '2024-01-01', productId, quantityMilli: 10000, totalCost: 50000, userId });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const stock = () => db.prepare('SELECT quantity_milli AS q, total_value AS v FROM products WHERE id = ?').get(productId);
const balanced = () => accounting.trialBalance(db).isBalanced;
const sale = (overrides = {}) => invoices.createInvoice(db, userId, {
  docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'credit',
  items: [{ productId, quantity: 2, unitPrice: 8000 }], ...overrides,
});

test('cash sale posts revenue, cost of goods and cash receipt, and reduces stock at average cost', () => {
  const result = invoices.createInvoice(db, userId, {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    items: [{ productId, quantity: 2, unitPrice: 8000 }],
  });
  assert.equal(result.total, 16000);
  assert.equal(result.paidAmount, 16000);
  assert.deepEqual(stock(), { q: 8000, v: 40000 });
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_sales' }).closing, -16000);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_cogs' }).closing, 10000);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_cash' }).closing, 16000);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_ar' }).closing, 0);
  assert.equal(balanced(), true);
});

test('credit sale creates a receivable; partial payment then full settlement', () => {
  const inv = sale();
  assert.equal(parties.partyBalance(db, customerId), 16000);
  invoices.recordPayment(db, userId, { invoiceId: inv.id, date: '2024-02-05', amount: 6000, cashboxId: 'cashbox_main' });
  assert.equal(parties.partyBalance(db, customerId), 10000);
  assert.throws(() => invoices.recordPayment(db, userId, { invoiceId: inv.id, date: '2024-02-06', amount: 11000, cashboxId: 'cashbox_main' }),
    (e) => e instanceof UserFacingError);
  invoices.recordPayment(db, userId, { invoiceId: inv.id, date: '2024-02-06', amount: 10000, cashboxId: 'cashbox_main' });
  assert.equal(parties.partyBalance(db, customerId), 0);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_ar' }).closing, 0);
  assert.equal(balanced(), true);
});

test('sale larger than stock on hand is rejected and nothing is written', () => {
  const before = db.prepare('SELECT COUNT(*) AS c FROM journal_entries').get().c;
  assert.throws(() => sale({ items: [{ productId, quantity: 50, unitPrice: 8000 }] }), (e) => e instanceof UserFacingError);
  assert.deepEqual(stock(), { q: 10000, v: 50000 });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_entries').get().c, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM invoices').get().c, 0);
});

test('purchase on credit increases stock and payable; paying the supplier settles it', () => {
  const inv = invoices.createInvoice(db, userId, {
    docType: 'purchase', date: '2024-02-01', partyId: supplierId, paymentMethod: 'credit',
    items: [{ productId, quantity: 4, unitPrice: 6000 }],
  });
  assert.equal(parties.partyBalance(db, supplierId), -24000);
  assert.deepEqual(stock(), { q: 14000, v: 74000 });
  invoices.recordPayment(db, userId, { invoiceId: inv.id, date: '2024-02-03', amount: 24000, cashboxId: 'cashbox_main' });
  assert.equal(parties.partyBalance(db, supplierId), 0);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_ap' }).closing, 0);
  assert.equal(balanced(), true);
});

test('sales return restores stock at the original cost and cannot exceed quantity sold', () => {
  const inv = sale();
  invoices.createReturn(db, userId, {
    returnType: 'sales_return', invoiceId: inv.id, date: '2024-02-10',
    items: [{ productId, quantity: 1 }],
  });
  assert.deepEqual(stock(), { q: 9000, v: 45000 });
  assert.equal(parties.partyBalance(db, customerId), 8000);
  assert.equal(balanced(), true);
  assert.throws(() => invoices.createReturn(db, userId, {
    returnType: 'sales_return', invoiceId: inv.id, date: '2024-02-11', items: [{ productId, quantity: 2 }],
  }), (e) => e instanceof UserFacingError);
});

test('purchase return removes stock at average cost and the price difference goes to purchase returns', () => {
  const inv = invoices.createInvoice(db, userId, {
    docType: 'purchase', date: '2024-02-01', partyId: supplierId, paymentMethod: 'credit',
    items: [{ productId, quantity: 2, unitPrice: 7000 }],
  });
  invoices.createReturn(db, userId, {
    returnType: 'purchase_return', invoiceId: inv.id, date: '2024-02-02', items: [{ productId, quantity: 1 }],
  });
  assert.equal(parties.partyBalance(db, supplierId), -7000);
  assert.equal(balanced(), true);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_purchase_returns' }).closing, -1667);
});
