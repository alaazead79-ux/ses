const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { registerFarmHandlers } = require('../src/ipc/farmHandlers');
const parties = require('../src/services/partyService');
const inventory = require('../src/services/inventoryService');

let tmpDir;
let db;
let handlers;
let customerId;
let productId;
const OWNER_KEY = 'owner-session';

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-sales-ipc-'));
  db = openDatabase(tmpDir).db;
  const auth = createAuthService(db);
  const owner = await auth.setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  await auth.login(OWNER_KEY, { username: 'owner', password: 'owner-pass-1' });
  customerId = parties.createParty(db, owner.id, { name: 'عميل', type: 'customer' }).id;
  productId = inventory.createProduct(db, owner.id, { name: 'علف مركز', unit: 'كيس' }).id;
  inventory.receiveStock(db, { date: '2024-01-01', productId, quantityMilli: 10000, totalCost: 50000, userId: owner.id });

  handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  registerFarmHandlers(ipcMain, auth, () => db, () => tmpDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function invoke(channel, payload, key = OWNER_KEY) {
  return handlers.get(channel)({ sender: { id: key } }, payload);
}

test('channels refuse callers without a signed-in session', async () => {
  const result = await invoke('invoices:list', { docType: 'sales' }, 'stranger');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('products list exposes stock and cost for the sales screen', async () => {
  const result = await invoke('products:list');
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].quantity_milli, 10000);
  assert.equal(result.data[0].unit_cost, 5000);
});

test('a partly paid sale is listed with its lines and outstanding amount, then paid off', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 6000, items: [{ productId, quantity: 2, unitPrice: 8000, discount: 0 }],
  });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.total, 16000);
  assert.equal(created.data.paidAmount, 6000);

  const listed = await invoke('invoices:list', { docType: 'sales' });
  assert.equal(listed.ok, true);
  const [invoice] = listed.data;
  assert.equal(invoice.id, created.data.id);
  assert.equal(invoice.outstanding, 10000);
  assert.equal(invoice.items.length, 1);
  assert.equal(invoice.items[0].quantity_milli, 2000);

  const paid = await invoke('invoices:pay', {
    invoiceId: created.data.id, date: '2024-02-05', amount: 10000, method: 'cash', cashboxId: 'cashbox_main',
  });
  assert.equal(paid.ok, true, paid.error);

  const after = await invoke('invoices:list', { docType: 'sales' });
  assert.equal(after.data[0].outstanding, 0);
});

test('a sales return restores stock and is refused beyond the invoiced quantity', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'credit',
    items: [{ productId, quantity: 1, unitPrice: 8000, discount: 0 }],
  });
  const returned = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-03',
    items: [{ productId, quantity: 1 }],
  });
  assert.equal(returned.ok, true, returned.error);
  assert.equal(returned.data.total, 8000);
  assert.equal(returned.data.cost, 5000);

  const products = await invoke('products:list');
  assert.equal(products.data[0].quantity_milli, 10000);

  const again = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-04',
    items: [{ productId, quantity: 1 }],
  });
  assert.equal(again.ok, false);
  assert.match(again.error, /الكمية المرتجعة تتجاوز/);
});

test('overpaying an invoice is refused with a user-facing message', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'credit',
    items: [{ productId, quantity: 1, unitPrice: 8000, discount: 0 }],
  });
  const result = await invoke('invoices:pay', {
    invoiceId: created.data.id, date: '2024-02-02', amount: 9000, method: 'cash', cashboxId: 'cashbox_main',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /المبلغ أكبر من المتبقي/);
});

function balancedReversal(invoiceId) {
  const row = db.prepare(`
    SELECT SUM(jl.debit) AS d, SUM(jl.credit) AS c FROM journal_lines jl
    WHERE jl.entry_id = (SELECT cancel_journal_entry_id FROM invoices WHERE id = ?)
  `).get(invoiceId);
  return row;
}

test('cancelling a credit sale restores stock and posts a balanced reversal', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'credit',
    items: [{ productId, quantity: 2, unitPrice: 8000, discount: 0 }],
  });
  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-02' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.ok(cancelled.data.reversalEntryNumber);

  const products = await invoke('products:list');
  assert.equal(products.data[0].quantity_milli, 10000);
  assert.equal(products.data[0].total_value, 50000);

  const listed = await invoke('invoices:list', { docType: 'sales' });
  assert.equal(listed.data[0].status, 'cancelled');

  const reversal = balancedReversal(created.data.id);
  assert.equal(reversal.d, reversal.c);
  assert.equal(reversal.d, 26000);

  const again = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-03' });
  assert.equal(again.ok, false);
  assert.match(again.error, /ملغاة/);
});

test('cancelling a partly paid sale reverses the cash received and blocks later payments', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 6000, items: [{ productId, quantity: 2, unitPrice: 8000, discount: 0 }],
  });
  const cashBalance = () => db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS bal
    FROM cash_transactions WHERE cashbox_id = 'cashbox_main'
  `).get().bal;
  assert.equal(cashBalance(), 6000);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-03' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cashBalance(), 0);

  const paid = await invoke('invoices:pay', {
    invoiceId: created.data.id, date: '2024-02-04', amount: 1000, method: 'cash', cashboxId: 'cashbox_main',
  });
  assert.equal(paid.ok, false);
  assert.match(paid.error, /ملغاة/);
});

test('cancelling a purchase issues stock at its average cost and keeps the entry balanced', async () => {
  const supplierId = parties.createParty(db, null, { name: 'مورد الأعلاف', type: 'supplier' }).id;
  const created = await invoke('invoices:create', {
    docType: 'purchase', date: '2024-02-01', partyId: supplierId, paymentMethod: 'credit',
    items: [{ productId, quantity: 1, unitPrice: 6000, discount: 0 }],
  });
  assert.equal(created.ok, true, created.error);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-02' });
  assert.equal(cancelled.ok, true, cancelled.error);

  const products = await invoke('products:list');
  assert.equal(products.data[0].quantity_milli, 10000);

  const reversal = balancedReversal(created.data.id);
  assert.equal(reversal.d, reversal.c);
});
