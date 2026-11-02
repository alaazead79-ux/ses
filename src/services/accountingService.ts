import { getDb, toCents, toEgp } from '@/db/db';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  parent_id: string | null;
  is_active: boolean;
  is_system: boolean;
  balance: number; // قرش
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  date: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  activity_id: string | null;
  status: string;
  lines: JournalLine[];
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number; // قرش
  credit: number; // قرش
  description: string | null;
}

// ===================== دليل الحسابات =====================
export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  const res = await db.query<Account>(
    'SELECT id, code, name, type, parent_id, is_active, is_system, balance FROM accounts ORDER BY code'
  );
  return res.rows;
}

export async function createAccount(data: {
  code: string;
  name: string;
  type: string;
  parentId?: string | null;
}): Promise<Account> {
  const db = await getDb();
  const exists = await db.query<{ count: number }>('SELECT count(*) as count FROM accounts WHERE code = $1', [data.code]);
  if (exists.rows[0].count > 0) throw new Error('كود الحساب مستخدم بالفعل');

  const res = await db.query<Account>(
    `INSERT INTO accounts (code, name, type, parent_id) VALUES ($1, $2, $3, $4)
     RETURNING id, code, name, type, parent_id, is_active, is_system, balance`,
    [data.code, data.name, data.type, data.parentId ?? null]
  );
  return res.rows[0];
}

// ===================== ترقيم المستندات =====================
export async function nextDocNumber(docType: string): Promise<string> {
  const db = await getDb();
  const res = await db.query<{ prefix: string; next_number: number; padding: number }>(
    'SELECT prefix, next_number, padding FROM document_sequences WHERE doc_type = $1',
    [docType]
  );
  if (res.rows.length === 0) throw new Error(`نوع مستند غير معروف: ${docType}`);
  const seq = res.rows[0];
  const padded = String(seq.next_number).padStart(seq.padding, '0');
  const num = `${seq.prefix}-${padded}`;
  await db.query('UPDATE document_sequences SET next_number = next_number + 1, updated_at = now() WHERE doc_type = $1', [docType]);
  return num;
}

// ===================== إنشاء قيد محاسبي =====================
export async function createJournalEntry(data: {
  date: string;
  description?: string;
  referenceType?: string;
  referenceId?: string;
  activityId?: string | null;
  lines: { accountId: string; debit: number; credit: number; description?: string }[]; // مبالغ بجنيه
  createdBy?: string | null;
}): Promise<{ id: string; entryNumber: string }> {
  // التحقق من التوازن
  const totalDebit = data.lines.reduce((s, l) => s + toCents(l.debit), 0);
  const totalCredit = data.lines.reduce((s, l) => s + toCents(l.credit), 0);
  if (totalDebit !== totalCredit) {
    throw new Error(`القيد غير متوازن: مدين ${toEgp(totalDebit)} ≠ دائن ${toEgp(totalCredit)}`);
  }
  if (totalDebit === 0) throw new Error('لا يمكن ترحيل قيد بقيمة صفر');

  const db = await getDb();
  const entryNumber = await nextDocNumber('journal');

  const entryRes = await db.query<{ id: string }>(
    `INSERT INTO journal_entries (entry_number, date, description, reference_type, reference_id, activity_id, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7) RETURNING id`,
    [entryNumber, data.date, data.description ?? null, data.referenceType ?? null, data.referenceId ?? null, data.activityId ?? null, data.createdBy ?? null]
  );
  const entryId = entryRes.rows[0].id;

  for (const line of data.lines) {
    await db.query(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [entryId, line.accountId, toCents(line.debit), toCents(line.credit), line.description ?? null]
    );
    // تحديث رصيد الحساب
    await db.query(
      `UPDATE accounts SET balance = balance + $1 - $2, updated_at = now() WHERE id = $3`,
      [toCents(line.debit), toCents(line.credit), line.accountId]
    );
  }

  return { id: entryId, entryNumber };
}

// ===================== قيد عكسي (إلغاء) =====================
export async function reverseJournalEntry(entryId: string, date: string, createdBy?: string | null): Promise<void> {
  const db = await getDb();
  const entry = await db.query<JournalEntry>(
    `SELECT id, entry_number, date, description, reference_type, reference_id, activity_id, status FROM journal_entries WHERE id = $1`,
    [entryId]
  );
  if (entry.rows.length === 0) throw new Error('القيد غير موجود');
  if (entry.rows[0].status === 'reversed') throw new Error('القيد ملغى بالفعل');

  const lines = await db.query<{ account_id: string; debit: number; credit: number; description: string | null }>(
    'SELECT account_id, debit, credit, description FROM journal_lines WHERE entry_id = $1',
    [entryId]
  );

  // قيد عكسي: عكس المدين والدائن
  const revLines = lines.rows.map((l) => ({
    accountId: l.account_id,
    debit: toEgp(l.credit),
    credit: toEgp(l.debit),
    description: `قيد عكسي — ${l.description ?? ''}`,
  }));

  await createJournalEntry({
    date,
    description: `قيد عكسي لـ ${entry.rows[0].entry_number}`,
    referenceType: 'reversal',
    referenceId: entryId,
    activityId: entry.rows[0].activity_id,
    lines: revLines,
    createdBy,
  });

  await db.query("UPDATE journal_entries SET status = 'reversed' WHERE id = $1", [entryId]);
}

// ===================== القيود اليومية =====================
export async function listJournalEntries(limit = 50, offset = 0, filters?: { dateFrom?: string; dateTo?: string }): Promise<JournalEntry[]> {
  const db = await getDb();
  let query = `SELECT e.id, e.entry_number, e.date::text, e.description, e.reference_type, e.reference_id,
                      e.activity_id, e.status
               FROM journal_entries e WHERE 1=1`;
  const params: unknown[] = [];
  if (filters?.dateFrom) { params.push(filters.dateFrom); query += ` AND e.date >= $${params.length}`; }
  if (filters?.dateTo) { params.push(filters.dateTo); query += ` AND e.date <= $${params.length}`; }
  params.push(limit, offset);
  query += ` ORDER BY e.date DESC, e.entry_number DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const entries = await db.query<{
    id: string; entry_number: string; date: string; description: string | null;
    reference_type: string | null; reference_id: string | null; activity_id: string | null; status: string;
  }>(query, params);

  const result: JournalEntry[] = [];
  for (const e of entries.rows) {
    const lines = await db.query<{
      id: string; account_id: string; debit: number; credit: number; description: string | null;
      code: string; name: string;
    }>(
      `SELECT l.id, l.account_id, l.debit, l.credit, l.description, a.code, a.name
       FROM journal_lines l JOIN accounts a ON l.account_id = a.id WHERE l.entry_id = $1 ORDER BY l.id`,
      [e.id]
    );
    result.push({
      ...e,
      lines: lines.rows.map((l) => ({
        id: l.id, entry_id: e.id, account_id: l.account_id,
        account_code: l.code, account_name: l.name,
        debit: l.debit, credit: l.credit, description: l.description,
      })),
    });
  }
  return result;
}

// ===================== الأستاذ العام =====================
export interface LedgerRow {
  date: string;
  entry_number: string;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export async function getGeneralLedger(accountId: string, dateFrom?: string, dateTo?: string): Promise<{ account: Account; rows: LedgerRow[]; opening: number; closing: number }> {
  const db = await getDb();
  const accRes = await db.query<Account>('SELECT id, code, name, type, parent_id, is_active, is_system, balance FROM accounts WHERE id = $1', [accountId]);
  if (accRes.rows.length === 0) throw new Error('الحساب غير موجود');
  const account = accRes.rows[0];

  let query = `SELECT e.date::text, e.entry_number, e.description, l.debit, l.credit
               FROM journal_lines l JOIN journal_entries e ON l.entry_id = e.id
               WHERE l.account_id = $1 AND e.status = 'posted'`;
  const params: unknown[] = [accountId];
  if (dateFrom) { params.push(dateFrom); query += ` AND e.date >= $${params.length}`; }
  if (dateTo) { params.push(dateTo); query += ` AND e.date <= $${params.length}`; }
  query += ' ORDER BY e.date, e.entry_number, l.id';

  const rows = await db.query<{ date: string; entry_number: string; description: string | null; debit: number; credit: number }>(query, params);

  // الرصيد الافتتاحي = مجموع الحركات قبل dateFrom
  let opening = 0;
  if (dateFrom) {
    const openRes = await db.query<{ debit: number; credit: number }>(
      `SELECT COALESCE(SUM(l.debit),0) as debit, COALESCE(SUM(l.credit),0) as credit
       FROM journal_lines l JOIN journal_entries e ON l.entry_id = e.id
       WHERE l.account_id = $1 AND e.status = 'posted' AND e.date < $2`,
      [accountId, dateFrom]
    );
    opening = openRes.rows[0].debit - openRes.rows[0].credit;
  }

  let balance = opening;
  const ledgerRows: LedgerRow[] = [{ date: '', entry_number: '', description: 'رصيد افتتاحي', debit: 0, credit: 0, balance }];
  for (const r of rows.rows) {
    balance += r.debit - r.credit;
    ledgerRows.push({ ...r, balance });
  }

  return { account, rows: ledgerRows, opening, closing: balance };
}

// ===================== ميزان المراجعة =====================
export interface TrialBalanceRow {
  account_id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

export async function getTrialBalance(dateFrom?: string, dateTo?: string): Promise<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number }> {
  const db = await getDb();
  let query = `
    SELECT a.id as account_id, a.code, a.name, a.type,
      COALESCE(SUM(l.debit), 0) as debit,
      COALESCE(SUM(l.credit), 0) as credit
    FROM accounts a
    LEFT JOIN journal_lines l ON l.account_id = a.id
    LEFT JOIN journal_entries e ON l.entry_id = e.id AND e.status = 'posted'`;

  const params: unknown[] = [];
  const conditions: string[] = [];
  if (dateFrom) { params.push(dateFrom); conditions.push(`e.date >= $${params.length}`); }
  if (dateTo) { params.push(dateTo); conditions.push(`e.date <= $${params.length}`); }

  if (conditions.length) {
    query += ` AND ${conditions.join(' AND ')}`;
  }

  query += ` GROUP BY a.id, a.code, a.name, a.type ORDER BY a.code`;

  const res = await db.query<{ account_id: string; code: string; name: string; type: string; debit: number; credit: number }>(query, params);

  const rows: TrialBalanceRow[] = res.rows
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .map((r) => ({ ...r }));

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  return { rows, totalDebit, totalCredit };
}

// ===================== الأرصدة الافتتاحية =====================
export async function setOpeningBalance(data: { accountId: string; debit: number; credit: number; date: string }): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO opening_balances (account_id, debit, credit, date) VALUES ($1, $2, $3, $4)`,
    [data.accountId, toCents(data.debit), toCents(data.credit), data.date]
  );
  // إنشاء قيد افتتاحي
  await createJournalEntry({
    date: data.date,
    description: 'رصيد افتتاحي',
    referenceType: 'opening',
    lines: [{ accountId: data.accountId, debit: data.debit, credit: data.credit }],
  });
}

export async function listOpeningBalances(): Promise<{ account_id: string; code: string; name: string; debit: number; credit: number; date: string }[]> {
  const db = await getDb();
  const res = await db.query<{ account_id: string; code: string; name: string; debit: number; credit: number; date: string }>(
    `SELECT ob.account_id, a.code, a.name, ob.debit, ob.credit, ob.date::text
     FROM opening_balances ob JOIN accounts a ON ob.account_id = a.id ORDER BY a.code`
  );
  return res.rows;
}
