const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { assertIsoDate, requireText, optionalText, toPiastres } = require('../domain/money');
const { postJournalEntry } = require('../domain/postingEngine');

const PARTY_TYPES = ['customer', 'supplier', 'both'];
const PARTY_STATUSES = ['active', 'inactive', 'blocked'];
const OPENING_OFFSET_ACCOUNT = 'acc_capital';

function readParty(db, partyId) {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(partyId);
  if (!party) throw new UserFacingError('الطرف غير موجود');
  return party;
}

function partyBalance(db, partyId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS net
    FROM party_transactions WHERE party_id = ?
  `).get(partyId);
  return row.net;
}

function listParties(db, { type = null, search = '' } = {}) {
  const conditions = ['1 = 1'];
  const params = [];
  if (type) {
    if (!PARTY_TYPES.includes(type)) throw new UserFacingError('نوع الطرف غير صالح');
    conditions.push('p.type = ?');
    params.push(type);
  }
  const term = String(search ?? '').trim();
  if (term) {
    conditions.push('(p.name LIKE ? OR p.phone LIKE ?)');
    params.push(`%${term}%`, `%${term}%`);
  }
  return db.prepare(`
    SELECT p.id, p.name, p.type, p.phone, p.status, p.activity_id,
      COALESCE(SUM(t.debit), 0) - COALESCE(SUM(t.credit), 0) AS balance
    FROM parties p LEFT JOIN party_transactions t ON t.party_id = p.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.id ORDER BY p.name
  `).all(...params);
}

function readPartyInput(input) {
  const type = input?.type;
  if (!PARTY_TYPES.includes(type)) throw new UserFacingError('نوع الطرف غير صالح');
  const status = input?.status ?? 'active';
  if (!PARTY_STATUSES.includes(status)) throw new UserFacingError('حالة الطرف غير صالحة');
  const activityId = input?.activityId ? String(input.activityId) : null;
  return {
    name: requireText(input?.name, 'الاسم', 120),
    type,
    phone: optionalText(input?.phone, 30),
    address: optionalText(input?.address, 200),
    notes: optionalText(input?.notes, 500),
    status,
    activityId,
  };
}

function createParty(db, userId, input) {
  const data = readPartyInput(input);
  if (data.activityId && !db.prepare('SELECT id FROM activities WHERE id = ?').get(data.activityId)) {
    throw new UserFacingError('النشاط غير موجود');
  }
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO parties (id, name, type, phone, address, notes, status, activity_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.type, data.phone, data.address, data.notes, data.status, data.activityId);
  audit(db, { userId, action: 'create', module: 'parties', entityId: id, entityType: 'party', details: { name: data.name } });
  return { id };
}

function updateParty(db, userId, partyId, input) {
  readParty(db, partyId);
  const data = readPartyInput(input);
  db.prepare(`
    UPDATE parties SET name = ?, type = ?, phone = ?, address = ?, notes = ?, status = ?, activity_id = ?, updated_at = ?
    WHERE id = ?
  `).run(data.name, data.type, data.phone, data.address, data.notes, data.status, data.activityId, new Date().toISOString(), partyId);
  audit(db, { userId, action: 'update', module: 'parties', entityId: partyId, entityType: 'party' });
}

function partyStatement(db, { partyId, dateFrom = null, dateTo = null }) {
  const party = readParty(db, partyId);
  const from = dateFrom ? assertIsoDate(dateFrom) : null;
  const to = dateTo ? assertIsoDate(dateTo) : null;
  const before = from
    ? db.prepare('SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS net FROM party_transactions WHERE party_id = ? AND date < ?')
      .get(partyId, from).net
    : 0;
  const conditions = ['party_id = ?'];
  const params = [partyId];
  if (from) { conditions.push('date >= ?'); params.push(from); }
  if (to) { conditions.push('date <= ?'); params.push(to); }
  const rows = db.prepare(`
    SELECT id, date, type, reference_type, reference_id, debit, credit, description
    FROM party_transactions WHERE ${conditions.join(' AND ')}
    ORDER BY date, created_at, rowid
  `).all(...params);
  let running = before;
  const statementRows = rows.map((row) => {
    running += row.debit - row.credit;
    return { ...row, balance: running };
  });
  return { party, opening: before, rows: statementRows, closing: running };
}

// رصيد افتتاحي: موجب = مدين لنا (عميل)، سالب = دائن لنا (مورد)، ويُسجَّل كقيد وحركة طرف
function recordPartyOpeningBalance(db, userId, input) {
  const partyId = String(input?.partyId ?? '');
  const party = readParty(db, partyId);
  const date = assertIsoDate(input?.date);
  const amount = toPiastres(input?.amount, 'الرصيد الافتتاحي', { allowZero: true });
  if (amount === 0) throw new UserFacingError('أدخل مبلغ الرصيد الافتتاحي');
  const side = input?.side === 'payable' ? 'payable' : 'receivable';
  if (party.type === 'customer' && side === 'payable') throw new UserFacingError('العميل لا يملك رصيدًا دائنًا افتتاحيًا هنا');
  if (party.type === 'supplier' && side === 'receivable') throw new UserFacingError('المورد لا يملك رصيدًا مدينًا افتتاحيًا هنا');
  if (db.prepare("SELECT id FROM party_transactions WHERE party_id = ? AND type = 'opening'").get(partyId)) {
    throw new UserFacingError('يوجد رصيد افتتاحي مسجل لهذا الطرف بالفعل');
  }

  return db.transaction(() => {
    const receivable = side === 'receivable';
    const control = receivable ? 'acc_ar' : 'acc_ap';
    const txId = crypto.randomUUID();
    const entry = postJournalEntry(db, {
      date,
      description: `رصيد افتتاحي — ${party.name}`,
      referenceType: 'party_opening',
      referenceId: txId,
      userId,
      lines: receivable
        ? [
          { accountId: control, debit: amount, description: party.name },
          { accountId: OPENING_OFFSET_ACCOUNT, credit: amount, description: 'مقابل الرصيد الافتتاحي' },
        ]
        : [
          { accountId: OPENING_OFFSET_ACCOUNT, debit: amount, description: 'مقابل الرصيد الافتتاحي' },
          { accountId: control, credit: amount, description: party.name },
        ],
    });
    db.prepare(`
      INSERT INTO party_transactions (id, party_id, date, type, reference_type, reference_id, debit, credit, description)
      VALUES (?, ?, ?, 'opening', 'journal_entry', ?, ?, ?, 'رصيد افتتاحي')
    `).run(txId, partyId, date, entry.id, receivable ? amount : 0, receivable ? 0 : amount);
    audit(db, { userId, action: 'create', module: 'parties', entityId: partyId, entityType: 'party', details: { opening: amount } });
    return { id: txId };
  })();
}

// الطرف الذي له أي حركة أو مستند لا يُحذف، ويُوقف بتغيير حالته بدلًا من ذلك
function deleteParty(db, userId, partyId) {
  readParty(db, partyId);
  const usage = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM party_transactions WHERE party_id = @id) +
      (SELECT COUNT(*) FROM invoices WHERE party_id = @id) +
      (SELECT COUNT(*) FROM returns WHERE party_id = @id) +
      (SELECT COUNT(*) FROM payments WHERE party_id = @id) +
      (SELECT COUNT(*) FROM cash_transactions WHERE party_id = @id) AS total
  `).get({ id: partyId }).total;
  if (usage > 0) throw new UserFacingError('لا يمكن حذف طرف له حركات. غيّر حالته إلى غير نشط بدلًا من ذلك');
  db.prepare('DELETE FROM parties WHERE id = ?').run(partyId);
  audit(db, { userId, action: 'delete', module: 'parties', entityId: partyId, entityType: 'party' });
}

// الرصيد الموجب مدين (عميل) والسالب دائن (مورد)، ويُسجَّل مع الطرف في معاملة واحدة
function createPartyWithOpening(db, userId, input) {
  const opening = input?.openingBalance ?? 0;
  if (!Number.isSafeInteger(opening)) throw new UserFacingError('الرصيد الافتتاحي غير صالح');
  return db.transaction(() => {
    const { id } = createParty(db, userId, input);
    if (opening !== 0) {
      recordPartyOpeningBalance(db, userId, {
        partyId: id,
        date: input?.date,
        amount: Math.abs(opening),
        side: opening > 0 ? 'receivable' : 'payable',
      });
    }
    return { id };
  })();
}

module.exports = {
  PARTY_TYPES,
  listParties,
  createParty,
  createPartyWithOpening,
  updateParty,
  deleteParty,
  partyStatement,
  partyBalance,
  recordPartyOpeningBalance,
};
