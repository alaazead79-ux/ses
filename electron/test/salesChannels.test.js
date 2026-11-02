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

function booksBalanced() {
  const row = db.prepare('SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM journal_lines').get();
  assert.equal(row.d, row.c);
}

function cashOf(cashboxId) {
  return db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS bal
    FROM cash_transactions WHERE cashbox_id = ?
  `).get(cashboxId).bal;
}

function partyBalance(partyId) {
  return db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS bal FROM party_transactions WHERE party_id = ?').get(partyId).bal;
}

test('a credit sale is returned in parts and refused beyond what remains', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'credit',
    items: [{ productId, quantity: 3, unitPrice: 8000, discount: 0 }],
  });
  assert.equal(created.ok, true, created.error);
  const paid = await invoke('invoices:pay', {
    invoiceId: created.data.id, date: '2024-02-02', amount: 10000, method: 'cash', cashboxId: 'cashbox_main',
  });
  assert.equal(paid.ok, true, paid.error);

  const first = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-03', items: [{ productId, quantity: 1 }],
  });
  assert.equal(first.ok, true, first.error);

  const afterFirst = await invoke('invoices:list', { docType: 'sales' });
  assert.equal(afterFirst.data[0].items[0].quantity_milli, 3000);
  assert.equal(afterFirst.data[0].items[0].returned_milli, 1000);

  const tooMuch = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-03', items: [{ productId, quantity: 2.5 }],
  });
  assert.equal(tooMuch.ok, false);
  assert.match(tooMuch.error, /المتبقي في الفاتورة \(2\)/);

  const second = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-04', items: [{ productId, quantity: 2 }],
  });
  assert.equal(second.ok, true, second.error);

  const exhausted = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-05', items: [{ productId, quantity: 0.001 }],
  });
  assert.equal(exhausted.ok, false);
  assert.match(exhausted.error, /المتبقي في الفاتورة \(0\)/);

  const afterAll = await invoke('invoices:list', { docType: 'sales' });
  assert.equal(afterAll.data[0].items[0].returned_milli, 3000);
  const products = await invoke('products:list');
  assert.equal(products.data[0].quantity_milli, 10000);
  booksBalanced();
});

function accountNet(accountId) {
  return db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS bal FROM journal_lines WHERE account_id = ?').get(accountId).bal;
}

async function stockOf() {
  return (await invoke('products:list')).data[0].quantity_milli;
}

test('cancelling a sale after a partial return reverses only the remaining quantity and cash', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 10000, items: [{ productId, quantity: 3, unitPrice: 8000, discount: 0 }],
  });
  assert.equal(created.ok, true, created.error);
  const returned = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-02', items: [{ productId, quantity: 1 }],
  });
  assert.equal(returned.ok, true, returned.error);
  assert.equal(partyBalance(customerId), 6000);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-03' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.data.refundedCash, 10000);
  assert.equal(cancelled.data.owedToCustomer, 0);
  assert.equal(await stockOf(), 10000);
  assert.equal(cashOf('cashbox_main'), 0);
  assert.equal(partyBalance(customerId), 0);
  assert.equal(accountNet('acc_ar'), 0);
  assert.equal(accountNet('acc_sales') + accountNet('acc_sales_returns'), 0);
  assert.equal(accountNet('acc_cogs'), 0);
  assert.equal(balancedReversal(created.data.id).d, 36000);
  booksBalanced();
});

test('cancelling a sale after a full return refunds the cash paid and leaves no balance', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 8000, items: [{ productId, quantity: 1, unitPrice: 8000, discount: 0 }],
  });
  await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-02', items: [{ productId, quantity: 1 }],
  });

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-03' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.data.refundedCash, 8000);
  assert.equal(cancelled.data.owedToCustomer, 0);
  assert.equal(await stockOf(), 10000);
  assert.equal(cashOf('cashbox_main'), 0);
  assert.equal(partyBalance(customerId), 0);
  assert.equal(accountNet('acc_ar'), 0);
  assert.equal(accountNet('acc_sales') + accountNet('acc_sales_returns'), 0);
  assert.equal(accountNet('acc_cogs'), 0);
  booksBalanced();
});

test('cancelling a credit sale after a full return posts no new entry and leaves no balance', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'credit',
    items: [{ productId, quantity: 1, unitPrice: 8000, discount: 0 }],
  });
  await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-02', items: [{ productId, quantity: 1 }],
  });

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-03' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.data.reversalEntryNumber, null);
  assert.equal(cancelled.data.refundedCash, 0);
  assert.equal(cancelled.data.owedToCustomer, 0);
  assert.equal(await stockOf(), 10000);
  assert.equal(partyBalance(customerId), 0);
  assert.equal(accountNet('acc_ar'), 0);
  booksBalanced();
});

test('a fully returned sale whose cash is already spent owes the customer for later refund', async () => {
  const supplierId = parties.createParty(db, null, { name: 'مورد بعد المرتجع', type: 'supplier' }).id;
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 8000, items: [{ productId, quantity: 1, unitPrice: 8000, discount: 0 }],
  });
  await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-02', items: [{ productId, quantity: 1 }],
  });
  await invoke('invoices:create', {
    docType: 'purchase', date: '2024-02-02', partyId: supplierId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 8000, items: [{ productId, quantity: 1, unitPrice: 8000, discount: 0 }],
  });
  assert.equal(cashOf('cashbox_main'), 0);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-03' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.data.refundedCash, 0);
  assert.equal(cancelled.data.owedToCustomer, 8000);
  assert.equal(cancelled.data.reversalEntryNumber, null);
  assert.equal(cashOf('cashbox_main'), 0);
  assert.equal(partyBalance(customerId), -8000);
  booksBalanced();
});

test('cancelling is refused when returns exceed what the invoice still owes after its discount', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'credit', discount: 2000,
    items: [{ productId, quantity: 1, unitPrice: 8000, discount: 0 }],
  });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.total, 6000);
  const returned = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-02', items: [{ productId, quantity: 1 }],
  });
  assert.equal(returned.ok, true, returned.error);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-03' });
  assert.equal(cancelled.ok, false);
  assert.match(cancelled.error, /تتجاوز قيمتها المتبقية/);
  const listed = await invoke('invoices:list', { docType: 'sales' });
  assert.equal(listed.data[0].status, 'posted');
  booksBalanced();
});

// فاتورة نقدية كاملة ثم مرتجع كامل: رصيد دائن للعميل 8000 والنقد في الخزينة 8000
async function customerCreditFromFullReturn() {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 8000, items: [{ productId, quantity: 1, unitPrice: 8000, discount: 0 }],
  });
  assert.equal(created.ok, true, created.error);
  const returned = await invoke('invoices:return', {
    returnType: 'sales_return', invoiceId: created.data.id, date: '2024-02-02', items: [{ productId, quantity: 1 }],
  });
  assert.equal(returned.ok, true, returned.error);
  assert.equal(partyBalance(customerId), -8000);
  assert.equal(cashOf('cashbox_main'), 8000);
}

test('a customer credit left by a full return is refunded in parts until it is cleared', async () => {
  await customerCreditFromFullReturn();

  const first = await invoke('customers:refundCredit', {
    partyId: customerId, cashboxId: 'cashbox_main', date: '2024-02-03', amount: 3000,
  });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.data.creditAfter, 5000);
  assert.equal(cashOf('cashbox_main'), 5000);
  assert.equal(partyBalance(customerId), -5000);

  const rest = await invoke('customers:refundCredit', {
    partyId: customerId, cashboxId: 'cashbox_main', date: '2024-02-04', amount: 5000,
  });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(rest.data.creditAfter, 0);
  assert.equal(cashOf('cashbox_main'), 0);
  assert.equal(partyBalance(customerId), 0);

  const credits = await invoke('customers:credits');
  assert.equal(credits.data.length, 0);
  assert.equal(accountNet('acc_ar'), 0);
  assert.equal(await stockOf(), 10000);
  booksBalanced();
});

test('a customer refund is refused above the customer credit or the cashbox balance', async () => {
  await customerCreditFromFullReturn();
  const supplierId = parties.createParty(db, null, { name: 'مورد الصرف', type: 'supplier' }).id;

  const overCredit = await invoke('customers:refundCredit', {
    partyId: customerId, cashboxId: 'cashbox_main', date: '2024-02-03', amount: 8001,
  });
  assert.equal(overCredit.ok, false);
  assert.match(overCredit.error, /أكبر من الرصيد الدائن للعميل/);

  await invoke('invoices:create', {
    docType: 'purchase', date: '2024-02-02', partyId: supplierId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 6000, items: [{ productId, quantity: 1, unitPrice: 6000, discount: 0 }],
  });
  assert.equal(cashOf('cashbox_main'), 2000);

  const overBox = await invoke('customers:refundCredit', {
    partyId: customerId, cashboxId: 'cashbox_main', date: '2024-02-03', amount: 3000,
  });
  assert.equal(overBox.ok, false);
  assert.match(overBox.error, /أكبر من رصيد الخزينة/);

  const zero = await invoke('customers:refundCredit', {
    partyId: customerId, cashboxId: 'cashbox_main', date: '2024-02-03', amount: 0,
  });
  assert.equal(zero.ok, false);

  const toSupplier = await invoke('customers:refundCredit', {
    partyId: supplierId, cashboxId: 'cashbox_main', date: '2024-02-03', amount: 1000,
  });
  assert.equal(toSupplier.ok, false);
  assert.match(toSupplier.error, /اختر عميلًا/);

  assert.equal(cashOf('cashbox_main'), 2000);
  assert.equal(partyBalance(customerId), -8000);
  assert.equal(await stockOf(), 11000);
  booksBalanced();
});

test('a customer with no credit cannot be refunded', async () => {
  const otherId = parties.createParty(db, null, { name: 'عميل بلا رصيد', type: 'customer' }).id;
  const result = await invoke('customers:refundCredit', {
    partyId: otherId, cashboxId: 'cashbox_main', date: '2024-02-03', amount: 100,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /لا يوجد رصيد دائن/);
  booksBalanced();
});

test('cancelling a sale reverses a later payment and leaves no customer balance', async () => {
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'credit',
    items: [{ productId, quantity: 2, unitPrice: 8000, discount: 0 }],
  });
  const paid = await invoke('invoices:pay', {
    invoiceId: created.data.id, date: '2024-02-02', amount: 5000, method: 'cash', cashboxId: 'cashbox_main',
  });
  assert.equal(paid.ok, true, paid.error);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-03' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.data.refundedCash, 5000);
  assert.equal(cancelled.data.owedToCustomer, 0);
  assert.equal(cashOf('cashbox_main'), 0);
  assert.equal(partyBalance(customerId), 0);
  booksBalanced();
});

test('cancelling a sale whose cash was already spent owes the customer instead of going negative', async () => {
  const supplierId = parties.createParty(db, null, { name: 'مورد نقدي', type: 'supplier' }).id;
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 6000, items: [{ productId, quantity: 2, unitPrice: 8000, discount: 0 }],
  });
  assert.equal(created.ok, true, created.error);
  const spent = await invoke('invoices:create', {
    docType: 'purchase', date: '2024-02-01', partyId: supplierId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 6000, items: [{ productId, quantity: 1, unitPrice: 6000, discount: 0 }],
  });
  assert.equal(spent.ok, true, spent.error);
  assert.equal(cashOf('cashbox_main'), 0);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-02' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.data.refundedCash, 0);
  assert.equal(cancelled.data.owedToCustomer, 6000);
  assert.equal(cashOf('cashbox_main'), 0);
  assert.equal(partyBalance(customerId), -6000);
  booksBalanced();
});

test('cancelling a sale refunds the cash still on hand and owes the rest', async () => {
  const supplierId = parties.createParty(db, null, { name: 'مورد جزئي', type: 'supplier' }).id;
  const created = await invoke('invoices:create', {
    docType: 'sales', date: '2024-02-01', partyId: customerId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 6000, items: [{ productId, quantity: 2, unitPrice: 8000, discount: 0 }],
  });
  await invoke('invoices:create', {
    docType: 'purchase', date: '2024-02-01', partyId: supplierId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 4000, items: [{ productId, quantity: 1, unitPrice: 4000, discount: 0 }],
  });
  assert.equal(cashOf('cashbox_main'), 2000);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-02' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.data.refundedCash, 2000);
  assert.equal(cancelled.data.owedToCustomer, 4000);
  assert.equal(cashOf('cashbox_main'), 0);
  assert.equal(partyBalance(customerId), -4000);
  booksBalanced();
});

test('cancelling a cash purchase returns the cash paid to the supplier', async () => {
  const supplierId = parties.createParty(db, null, { name: 'مورد نقدي ثانٍ', type: 'supplier' }).id;
  const created = await invoke('invoices:create', {
    docType: 'purchase', date: '2024-02-01', partyId: supplierId, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    paidNow: 6000, items: [{ productId, quantity: 1, unitPrice: 6000, discount: 0 }],
  });
  assert.equal(created.ok, true, created.error);
  assert.equal(cashOf('cashbox_main'), -6000);

  const cancelled = await invoke('invoices:cancel', { invoiceId: created.data.id, date: '2024-02-02' });
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cashOf('cashbox_main'), 0);
  assert.equal(partyBalance(supplierId), 0);
  booksBalanced();
});
