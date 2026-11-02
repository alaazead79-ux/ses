import { getDb, toCents } from '@/db/db';
import { createJournalEntry, nextDocNumber } from './accountingService';

export interface Check {
  id: string;
  doc_number: string;
  check_number: string | null;
  bank_name: string | null;
  direction: string;
  party_id: string | null;
  party_name: string | null;
  amount: number;
  issue_date: string | null;
  due_date: string;
  activity_id: string | null;
  status: string;
  description: string | null;
}

export async function listChecks(filters?: { status?: string }): Promise<Check[]> {
  const db = await getDb();
  let query = `
    SELECT c.id, c.doc_number, c.check_number, c.bank_name, c.direction, c.party_id,
           p.name as party_name, c.amount, c.issue_date::text, c.due_date::text,
           c.activity_id, c.status, c.description
    FROM checks c LEFT JOIN parties p ON c.party_id = p.id WHERE 1=1`;
  const params: unknown[] = [];
  if (filters?.status) { params.push(filters.status); query += ` AND c.status = $${params.length}`; }
  query += ' ORDER BY c.due_date DESC';

  const res = await db.query<Check>(query, params);
  return res.rows;
}

export async function createCheck(data: {
  date: string;
  direction: 'incoming' | 'outgoing';
  partyId?: string | null;
  amount: number;
  bankName?: string;
  checkNumber?: string;
  issueDate?: string;
  dueDate: string;
  activityId?: string | null;
  description?: string;
  createdBy?: string | null;
}): Promise<{ id: string; docNumber: string }> {
  if (data.amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  const db = await getDb();
  const docNumber = await nextDocNumber(data.direction === 'incoming' ? 'check_in' : 'check_out');
  const amountCents = toCents(data.amount);

  const lines = data.direction === 'incoming'
    ? [{ accountId: 'acc_checks_recv', debit: data.amount, credit: 0 }, { accountId: 'acc_ar', debit: 0, credit: data.amount }]
    : [{ accountId: 'acc_ap', debit: data.amount, credit: 0 }, { accountId: 'acc_checks_pay', debit: 0, credit: data.amount }];

  const journal = await createJournalEntry({
    date: data.date,
    description: data.description ?? `شيك ${data.direction === 'incoming' ? 'وارد' : 'صادر'} ${docNumber}`,
    referenceType: 'check',
    activityId: data.activityId,
    lines,
    createdBy: data.createdBy,
  });

  const res = await db.query<{ id: string }>(
    `INSERT INTO checks (doc_number, check_number, bank_name, direction, party_id, amount, issue_date, due_date, activity_id, status, description, journal_entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [docNumber, data.checkNumber ?? null, data.bankName ?? null, data.direction, data.partyId ?? null, amountCents,
     data.issueDate ?? null, data.dueDate, data.activityId ?? null, data.direction === 'incoming' ? 'received' : 'issued',
     data.description ?? null, journal.id]
  );

  return { id: res.rows[0].id, docNumber };
}

export async function updateCheckStatus(id: string, status: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE checks SET status = $1 WHERE id = $2', [status, id]);
}

export interface FinancialTransfer {
  id: string;
  doc_number: string;
  ref_number: string | null;
  date: string;
  direction: string;
  amount: number;
  party_id: string | null;
  party_name: string | null;
  activity_id: string | null;
  method: string;
  status: string;
  description: string | null;
}

export async function listTransfers(): Promise<FinancialTransfer[]> {
  const db = await getDb();
  const res = await db.query<FinancialTransfer>(
    `SELECT f.id, f.doc_number, f.ref_number, f.date::text, f.direction, f.amount, f.party_id,
            p.name as party_name, f.activity_id, f.method, f.status, f.description
     FROM financial_transfers f LEFT JOIN parties p ON f.party_id = p.id ORDER BY f.date DESC`
  );
  return res.rows;
}

export async function createTransfer(data: {
  date: string;
  direction: 'inbound' | 'outbound';
  amount: number;
  partyId?: string | null;
  refNumber?: string;
  method?: string;
  activityId?: string | null;
  description?: string;
  createdBy?: string | null;
}): Promise<{ id: string; docNumber: string }> {
  if (data.amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  const db = await getDb();
  const docNumber = await nextDocNumber('transfer');

  const lines = data.direction === 'inbound'
    ? [{ accountId: 'acc_bank', debit: data.amount, credit: 0 }, { accountId: 'acc_ar', debit: 0, credit: data.amount }]
    : [{ accountId: 'acc_ap', debit: data.amount, credit: 0 }, { accountId: 'acc_bank', debit: 0, credit: data.amount }];

  const journal = await createJournalEntry({
    date: data.date,
    description: data.description ?? `تحويل ${data.direction === 'inbound' ? 'وارد' : 'صادر'} ${docNumber}`,
    referenceType: 'transfer',
    activityId: data.activityId,
    lines,
    createdBy: data.createdBy,
  });

  const res = await db.query<{ id: string }>(
    `INSERT INTO financial_transfers (doc_number, ref_number, date, direction, amount, party_id, activity_id, method, status, description, journal_entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $10) RETURNING id`,
    [docNumber, data.refNumber ?? null, data.date, data.direction, toCents(data.amount), data.partyId ?? null,
     data.activityId ?? null, data.method ?? 'bank_transfer', data.description ?? null, journal.id]
  );

  return { id: res.rows[0].id, docNumber };
}
