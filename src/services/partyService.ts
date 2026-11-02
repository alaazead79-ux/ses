import { getDb, toCents } from '@/db/db';
import {
  getDesktopApi,
  type DesktopPartyRow,
  type DesktopApi,
} from '@/lib/electronBridge';

export interface Party {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  address: string | null;
  contact: string | null;
  opening_balance: number;
  notes: string | null;
  status: string;
  activity_id: string | null;
  balance: number; // computed
  total_transactions: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fromDesktopRow(row: DesktopPartyRow): Party {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    phone: row.phone,
    address: null,
    contact: null,
    opening_balance: 0,
    notes: null,
    status: row.status,
    activity_id: row.activity_id,
    balance: row.balance,
    total_transactions: 0,
  };
}

export async function listParties(typeFilter?: string): Promise<Party[]> {
  const desktop = getDesktopApi();
  if (desktop) {
    const rows = await desktop.farm.parties.list();
    return rows
      .filter((row) => !typeFilter || row.type === typeFilter || row.type === 'both')
      .map(fromDesktopRow);
  }

  const db = await getDb();
  let query = `
    SELECT p.id, p.name, p.type, p.phone, p.address, p.contact,
           p.opening_balance, p.notes, p.status, p.activity_id,
           COALESCE(SUM(pt.debit - pt.credit), 0) + p.opening_balance as balance,
           COALESCE(SUM(pt.debit + pt.credit), 0) as total_transactions
    FROM parties p
    LEFT JOIN party_transactions pt ON pt.party_id = p.id
    GROUP BY p.id, p.name, p.type, p.phone, p.address, p.contact, p.opening_balance, p.notes, p.status, p.activity_id`;
  const params: unknown[] = [];
  if (typeFilter) {
    query = `
      SELECT p.id, p.name, p.type, p.phone, p.address, p.contact,
             p.opening_balance, p.notes, p.status, p.activity_id,
             COALESCE(SUM(pt.debit - pt.credit), 0) + p.opening_balance as balance,
             COALESCE(SUM(pt.debit + pt.credit), 0) as total_transactions
      FROM parties p
      LEFT JOIN party_transactions pt ON pt.party_id = p.id
      WHERE p.type = $1 OR p.type = 'both'
      GROUP BY p.id, p.name, p.type, p.phone, p.address, p.contact, p.opening_balance, p.notes, p.status, p.activity_id`;
    params.push(typeFilter);
  }
  query += ' ORDER BY p.name';
  const res = await db.query<Party>(query, params);
  return res.rows;
}

export interface CreatePartyInput {
  name: string;
  type: string;
  phone?: string;
  address?: string;
  contact?: string;
  openingBalance?: number;
  notes?: string;
  activityId?: string | null;
}

// الرصيد الافتتاحي بالجنيه: الموجب مدين (عميل)، والسالب دائن (مورد)
export async function createParty(data: CreatePartyInput): Promise<{ id: string }> {
  const desktop: DesktopApi | null = getDesktopApi();
  if (desktop) {
    return desktop.farm.parties.create({
      name: data.name,
      type: data.type,
      phone: data.phone ?? null,
      address: data.address ?? null,
      notes: data.notes ?? null,
      activityId: data.activityId ?? null,
      openingBalance: Math.round((data.openingBalance ?? 0) * 100),
      date: todayIso(),
    });
  }

  const db = await getDb();
  const res = await db.query<Party>(
    `INSERT INTO parties (name, type, phone, address, contact, opening_balance, notes, activity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, type, phone, address, contact, opening_balance, notes, status, activity_id`,
    [data.name, data.type, data.phone ?? null, data.address ?? null, data.contact ?? null,
     toCents(data.openingBalance ?? 0), data.notes ?? null, data.activityId ?? null]
  );
  return res.rows[0];
}

export async function updateParty(id: string, data: Partial<{
  name: string; type: string; phone: string; address: string; contact: string;
  openingBalance: number; notes: string; status: string; activityId: string;
}>): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, unknown> = {
    name: data.name, type: data.type, phone: data.phone, address: data.address,
    contact: data.contact, notes: data.notes, status: data.status, activity_id: data.activityId,
  };
  for (const [key, val] of Object.entries(map)) {
    if (val !== undefined) { values.push(val); fields.push(`${key} = $${values.length}`); }
  }
  if (data.openingBalance !== undefined) { values.push(toCents(data.openingBalance)); fields.push(`opening_balance = $${values.length}`); }
  if (fields.length === 0) return;
  values.push(id);
  await db.query(`UPDATE parties SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
}

export async function deleteParty(id: string): Promise<void> {
  const desktop = getDesktopApi();
  if (desktop) {
    await desktop.farm.parties.delete(id);
    return;
  }
  const db = await getDb();
  await db.query('DELETE FROM parties WHERE id = $1', [id]);
}

export interface PartyStatementRow {
  date: string;
  type: string;
  reference_type: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export async function getPartyStatement(partyId: string, dateFrom?: string, dateTo?: string): Promise<{ party: Party; rows: PartyStatementRow[]; opening: number; closing: number }> {
  const desktop = getDesktopApi();
  if (desktop) {
    const statement = await desktop.farm.parties.statement({
      partyId,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
    });
    const rows: PartyStatementRow[] = [
      { date: '', type: 'opening', reference_type: null, description: 'رصيد افتتاحي', debit: 0, credit: 0, balance: statement.opening },
      ...statement.rows.map((row) => ({
        date: row.date,
        type: row.type,
        reference_type: row.reference_type,
        description: row.description,
        debit: row.debit,
        credit: row.credit,
        balance: 0,
      })),
    ];
    let running = statement.opening;
    for (const row of rows.slice(1)) {
      running += row.debit - row.credit;
      row.balance = running;
    }
    return {
      party: fromDesktopRow({ ...statement.party, balance: statement.closing }),
      rows,
      opening: statement.opening,
      closing: statement.closing,
    };
  }

  const db = await getDb();
  const pRes = await db.query('SELECT * FROM parties WHERE id = $1', [partyId]);
  if (pRes.rows.length === 0) throw new Error('الطرف غير موجود');
  const party = pRes.rows[0] as Party;

  let query = `SELECT date::text, type, reference_type, description, debit, credit FROM party_transactions WHERE party_id = $1`;
  const params: unknown[] = [partyId];
  if (dateFrom) { params.push(dateFrom); query += ` AND date >= $${params.length}`; }
  if (dateTo) { params.push(dateTo); query += ` AND date <= $${params.length}`; }
  query += ' ORDER BY date, id';

  const res = await db.query<{ date: string; type: string; reference_type: string | null; description: string | null; debit: number; credit: number }>(query, params);

  let balance = party.opening_balance;
  const rows: PartyStatementRow[] = [{ date: '', type: 'opening', reference_type: null, description: 'رصيد افتتاحي', debit: 0, credit: 0, balance: balance }];
  for (const r of res.rows) {
    balance += r.debit - r.credit;
    rows.push({ ...r, balance });
  }
  return { party, rows, opening: party.opening_balance, closing: balance };
}

export async function recordPartyTransaction(data: {
  partyId: string;
  date: string;
  type: string;
  referenceType?: string;
  referenceId?: string;
  debit?: number;
  credit?: number;
  description?: string;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO party_transactions (party_id, date, type, reference_type, reference_id, debit, credit, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [data.partyId, data.date, data.type, data.referenceType ?? null, data.referenceId ?? null,
     toCents(data.debit ?? 0), toCents(data.credit ?? 0), data.description ?? null]
  );
}
