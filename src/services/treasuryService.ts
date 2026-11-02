import { getDb, toCents } from '@/db/db';
import { createJournalEntry, nextDocNumber } from './accountingService';

export interface Cashbox {
  id: string;
  name: string;
  opening_balance: number;
  balance: number;
  is_active: boolean;
}

export interface CashTransaction {
  id: string;
  doc_number: string;
  date: string;
  type: string;
  cashbox_id: string;
  amount: number;
  party_id: string | null;
  party_name: string | null;
  activity_id: string | null;
  payment_method: string;
  description: string | null;
}

export async function ensureDefaultCashbox(): Promise<void> {
  const db = await getDb();
  const res = await db.query<{ count: number }>('SELECT count(*) as count FROM cashboxes');
  if (res.rows[0].count === 0) {
    await db.query('INSERT INTO cashboxes (name, opening_balance, balance) VALUES ($1, 0, 0)', ['الخزينة الرئيسية']);
  }
}

export async function listCashboxes(): Promise<Cashbox[]> {
  await ensureDefaultCashbox();
  const db = await getDb();
  const res = await db.query<Cashbox>('SELECT id, name, opening_balance, balance, is_active FROM cashboxes ORDER BY name');
  return res.rows;
}

export async function listCashTransactions(limit = 100, filters?: { type?: string; dateFrom?: string; dateTo?: string }): Promise<CashTransaction[]> {
  const db = await getDb();
  let query = `
    SELECT c.id, c.doc_number, c.date::text, c.type, c.cashbox_id, c.amount, c.party_id,
           p.name as party_name, c.activity_id, c.payment_method, c.description
    FROM cash_transactions c LEFT JOIN parties p ON c.party_id = p.id WHERE 1=1`;
  const params: unknown[] = [];
  if (filters?.type) { params.push(filters.type); query += ` AND c.type = $${params.length}`; }
  if (filters?.dateFrom) { params.push(filters.dateFrom); query += ` AND c.date >= $${params.length}`; }
  if (filters?.dateTo) { params.push(filters.dateTo); query += ` AND c.date <= $${params.length}`; }
  params.push(limit);
  query += ` ORDER BY c.date DESC, c.doc_number DESC LIMIT $${params.length}`;

  const res = await db.query<CashTransaction>(query, params);
  return res.rows;
}

export async function createCashTransaction(data: {
  date: string;
  type: 'receipt' | 'payment' | 'deposit' | 'withdrawal' | 'opening';
  cashboxId: string;
  amount: number;
  partyId?: string | null;
  activityId?: string | null;
  paymentMethod?: string;
  description?: string;
  createdBy?: string | null;
}): Promise<{ id: string; docNumber: string }> {
  if (data.amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  const db = await getDb();
  const docType = data.type === 'receipt' ? 'receipt' : data.type === 'payment' ? 'payment' : 'receipt';
  const docNumber = await nextDocNumber(docType);
  const amountCents = toCents(data.amount);

  // القيد: قبض — مدين الخزينة، دائن الطرف/الحساب | صرف — مدين المصروف، دائن الخزينة
  const isReceipt = data.type === 'receipt' || data.type === 'deposit' || data.type === 'opening';
  const lines = isReceipt
    ? [{ accountId: 'acc_cash', debit: data.amount, credit: 0 }, { accountId: 'acc_ar', debit: 0, credit: data.amount }]
    : [{ accountId: 'acc_admin', debit: data.amount, credit: 0 }, { accountId: 'acc_cash', debit: 0, credit: data.amount }];

  const journal = await createJournalEntry({
    date: data.date,
    description: data.description ?? `سند ${isReceipt ? 'قبض' : 'صرف'} ${docNumber}`,
    referenceType: 'cash',
    activityId: data.activityId,
    lines,
    createdBy: data.createdBy,
  });

  const res = await db.query<{ id: string }>(
    `INSERT INTO cash_transactions (doc_number, date, type, cashbox_id, amount, party_id, activity_id, payment_method, description, journal_entry_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [docNumber, data.date, data.type, data.cashboxId, amountCents, data.partyId ?? null, data.activityId ?? null,
     data.paymentMethod ?? 'cash', data.description ?? null, journal.id, data.createdBy ?? null]
  );

  // تحديث رصيد الخزينة
  const delta = isReceipt ? amountCents : -amountCents;
  await db.query('UPDATE cashboxes SET balance = balance + $1, updated_at = now() WHERE id = $2', [delta, data.cashboxId]);

  return { id: res.rows[0].id, docNumber };
}
