const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createAuthService } = require('../src/auth/authService');
const { UserFacingError } = require('../src/errors');
const parties = require('../src/services/partyService');
const accounting = require('../src/services/accountingService');

let tmpDir;
let db;
let userId;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-party-'));
  const database = openDatabase(tmpDir);
  db = database.db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('customer receivable opening balance is posted to receivables and the party statement', () => {
  const { id } = parties.createParty(db, userId, { name: 'أحمد', type: 'customer' });
  parties.recordPartyOpeningBalance(db, userId, { partyId: id, date: '2024-01-01', amount: 5000, side: 'receivable' });
  assert.equal(parties.partyBalance(db, id), 5000);
  assert.equal(parties.partyStatement(db, { partyId: id }).closing, 5000);
  const tb = accounting.trialBalance(db);
  assert.equal(tb.isBalanced, true);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_ar' }).closing, 5000);
});

test('supplier opening balance is a payable (negative party balance)', () => {
  const { id } = parties.createParty(db, userId, { name: 'مورد الأعلاف', type: 'supplier' });
  parties.recordPartyOpeningBalance(db, userId, { partyId: id, date: '2024-01-01', amount: 3000, side: 'payable' });
  assert.equal(parties.partyBalance(db, id), -3000);
  assert.equal(accounting.generalLedger(db, { accountId: 'acc_ap' }).closing, -3000);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
});

test('party opening balance cannot be recorded twice or on the wrong side', () => {
  const customer = parties.createParty(db, userId, { name: 'عميل', type: 'customer' });
  assert.throws(() => parties.recordPartyOpeningBalance(db, userId, { partyId: customer.id, date: '2024-01-01', amount: 100, side: 'payable' }),
    (e) => e instanceof UserFacingError);
  parties.recordPartyOpeningBalance(db, userId, { partyId: customer.id, date: '2024-01-01', amount: 100, side: 'receivable' });
  assert.throws(() => parties.recordPartyOpeningBalance(db, userId, { partyId: customer.id, date: '2024-01-01', amount: 100, side: 'receivable' }),
    (e) => e instanceof UserFacingError && e.message === 'يوجد رصيد افتتاحي مسجل لهذا الطرف بالفعل');
});

test('party names and types are validated and list search works', () => {
  assert.throws(() => parties.createParty(db, userId, { name: ' ', type: 'customer' }), (e) => e instanceof UserFacingError);
  assert.throws(() => parties.createParty(db, userId, { name: 'x', type: 'bank' }), (e) => e instanceof UserFacingError);
  parties.createParty(db, userId, { name: 'علي محمد', type: 'customer', phone: '0100' });
  parties.createParty(db, userId, { name: 'شركة النور', type: 'supplier' });
  assert.equal(parties.listParties(db, { search: 'النور' }).length, 1);
  assert.equal(parties.listParties(db, { type: 'customer' }).length, 1);
});
