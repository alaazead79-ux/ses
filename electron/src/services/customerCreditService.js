const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { assertIsoDate, toPiastres } = require('../domain/money');
const { nextDocNumber, postJournalEntry } = require('../domain/postingEngine');
const { requireActiveCashbox, cashboxBalance, insertCashTransaction } = require('./treasuryService');

// الرصيد الدائن = ما ندين به للعميل (الرصيد مدين − دائن أقل من الصفر)
function customerCredit(db, partyId) {
  const row = db.prepare('SELECT COALESCE(SUM(credit - debit), 0) AS credit FROM party_transactions WHERE party_id = ?').get(partyId);
  return row.credit;
}

function listCustomerCredits(db) {
  return db.prepare(`
    SELECT p.id, p.name, SUM(t.credit - t.debit) AS credit
    FROM parties p JOIN party_transactions t ON t.party_id = p.id
    WHERE p.type IN ('customer', 'both')
    GROUP BY p.id, p.name
    HAVING SUM(t.credit - t.debit) > 0
    ORDER BY p.name
  `).all();
}

// رد الرصيد الدائن للعميل نقدًا: قيد Dr العميل / Cr الخزينة، وحركة صرف، وحركة طرف
function refundCustomerCredit(db, userId, input) {
  const party = db.prepare('SELECT id, name, type FROM parties WHERE id = ?').get(String(input?.partyId ?? ''));
  if (!party) throw new UserFacingError('العميل غير موجود');
  if (party.type !== 'customer' && party.type !== 'both') throw new UserFacingError('اختر عميلًا لرد الرصيد');
  const date = assertIsoDate(input?.date);
  const amount = toPiastres(input?.amount, 'المبلغ');
  const box = requireActiveCashbox(db, input?.cashboxId);

  return db.transaction(() => {
    const credit = customerCredit(db, party.id);
    if (credit <= 0) throw new UserFacingError('لا يوجد رصيد دائن لهذا العميل');
    if (amount > credit) throw new UserFacingError(`المبلغ أكبر من الرصيد الدائن للعميل (${credit})`);
    const cash = cashboxBalance(db, box.id);
    if (amount > cash) throw new UserFacingError(`المبلغ أكبر من رصيد الخزينة (${cash})`);

    const refundId = crypto.randomUUID();
    const docNumber = nextDocNumber(db, 'payment');
    const entry = postJournalEntry(db, {
      date,
      description: docNumber,
      referenceType: 'customer_refund',
      referenceId: refundId,
      lines: [{ accountId: 'acc_ar', debit: amount }, { accountId: box.account_id, credit: amount }],
      userId,
    });
    insertCashTransaction(db, {
      docNumber,
      date,
      type: 'payment',
      direction: 'out',
      cashboxId: box.id,
      amount,
      sourceType: 'customer_refund',
      sourceId: refundId,
      description: `رد رصيد ${party.name}`,
      journalEntryId: entry.id,
      userId,
    });
    db.prepare(`
      INSERT INTO party_transactions (id, party_id, date, type, reference_type, reference_id, debit, credit, description)
      VALUES (?, ?, ?, 'payment', 'customer_refund', ?, ?, 0, ?)
    `).run(crypto.randomUUID(), party.id, date, refundId, amount, docNumber);

    audit(db, { userId, action: 'create', module: 'sales', entityId: refundId, entityType: 'customer_refund', details: { docNumber, amount } });
    return { id: refundId, docNumber, amount, creditAfter: credit - amount };
  })();
}

module.exports = { listCustomerCredits, refundCustomerCredit };
