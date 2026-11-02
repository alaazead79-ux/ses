const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const parties = require('../src/services/partyService');
const invoices = require('../src/services/invoiceService');
const treasury = require('../src/services/treasuryService');
const accounting = require('../src/services/accountingService');

let tmpDir;
let db;
let userId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-treasury-'));
  db = openDatabase(tmpDir).db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const balanceOf = (cashboxId) => treasury.listCashboxes(db).find((b) => b.id === cashboxId).balance;

test('cashbox balance is opening plus receipts minus payments, and the statement agrees', () => {
  const box = treasury.createCashbox(db, userId, { name: 'خزينة الفرع', openingBalance: 5000, date: '2024-01-01' });
  assert.equal(balanceOf(box.id), 5000);
  const statement = treasury.cashStatement(db, { cashboxId: box.id });
  assert.equal(statement.opening, 5000);
  assert.equal(statement.closing, 5000);
  assert.equal(accounting.generalLedger(db, { accountId: db.prepare('SELECT account_id FROM cashboxes WHERE id = ?').get(box.id).account_id }).closing, 5000);
});

test('cash sale receipts appear in the main cashbox and the cash ledger', () => {
  const customer = parties.createParty(db, userId, { name: 'عميل نقدي', type: 'customer' });
  const product = require('../src/services/inventoryService').createProduct(db, userId, { name: 'صنف', unit: 'كيس' });
  require('../src/services/inventoryService').receiveStock(db, { date: '2024-01-01', productId: product.id, quantityMilli: 5000, totalCost: 25000, userId });
  invoices.createInvoice(db, userId, {
    docType: 'sales', date: '2024-01-10', partyId: customer.id, paymentMethod: 'cash', cashboxId: 'cashbox_main',
    items: [{ productId: product.id, quantity: 1, unitPrice: 9000 }],
  });
  assert.equal(balanceOf('cashbox_main'), 9000);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_cash' }).closing, 9000);
});

test('transfers and checks are recorded and move only through their allowed statuses', () => {
  const transfer = treasury.createTransfer(db, userId, { direction: 'inbound', amount: 12000, date: '2024-03-01', method: 'bank_transfer' });
  treasury.updateTransferStatus(db, userId, transfer.id, 'completed');
  assert.throws(() => treasury.updateTransferStatus(db, userId, transfer.id, 'pending'), (e) => e instanceof UserFacingError);

  const incoming = treasury.createCheck(db, userId, { direction: 'incoming', amount: 3000, dueDate: '2024-04-01', checkNumber: '88' });
  assert.equal(treasury.listChecks(db).find((c) => c.id === incoming.id).status, 'received');
  treasury.updateCheckStatus(db, userId, incoming.id, 'collected');
  assert.throws(() => treasury.updateCheckStatus(db, userId, incoming.id, 'paid'), (e) => e instanceof UserFacingError);
});

test('checks are numbered by direction', () => {
  const incoming = treasury.createCheck(db, userId, { direction: 'incoming', amount: 100, dueDate: '2024-04-01' });
  const outgoing = treasury.createCheck(db, userId, { direction: 'outgoing', amount: 100, dueDate: '2024-04-01' });
  assert.match(incoming.docNumber, /^CHK-I-/);
  assert.match(outgoing.docNumber, /^CHK-O-/);
});
