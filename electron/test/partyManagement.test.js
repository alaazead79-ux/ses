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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-party-mgmt-'));
  db = openDatabase(tmpDir).db;
  const owner = await createAuthService(db).setupOwner('w', { username: 'owner', displayName: 'المالك', password: 'owner-pass-1' });
  userId = owner.id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a party with no history can be deleted', () => {
  const { id } = parties.createPartyWithOpening(db, userId, { name: 'عميل جديد', type: 'customer' });
  parties.deleteParty(db, userId, id);
  assert.equal(parties.listParties(db).some((p) => p.id === id), false);
});

test('a party with a recorded opening balance cannot be deleted', () => {
  const { id } = parties.createPartyWithOpening(db, userId, {
    name: 'عميل بدين', type: 'customer', openingBalance: 15000, date: '2024-01-01',
  });
  assert.throws(() => parties.deleteParty(db, userId, id), UserFacingError);
  assert.equal(parties.listParties(db).find((p) => p.id === id).balance, 15000);
});

test('an opening supplier balance is recorded as payable and balances the books', () => {
  const { id } = parties.createPartyWithOpening(db, userId, {
    name: 'مورد الأعلاف', type: 'supplier', openingBalance: -20000, date: '2024-01-01',
  });
  assert.equal(parties.listParties(db).find((p) => p.id === id).balance, -20000);
  assert.equal(accounting.trialBalance(db).isBalanced, true);
});

test('an unknown party cannot be deleted', () => {
  assert.throws(() => parties.deleteParty(db, userId, 'missing'), UserFacingError);
});
