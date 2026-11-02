import { getDb, toCents } from '@/db/db';
import { createJournalEntry } from './accountingService';

export interface ExpenseCategory {
  id: string;
  name: string;
  account_id: string | null;
}

export interface IncomeCategory {
  id: string;
  name: string;
  account_id: string | null;
}

export interface Expense {
  id: string;
  doc_number: string;
  date: string;
  category_name: string | null;
  amount: number;
  activity_id: string | null;
  payment_method: string;
  description: string | null;
  is_shared: boolean;
}

export interface Income {
  id: string;
  doc_number: string;
  date: string;
  category_name: string | null;
  amount: number;
  activity_id: string | null;
  payment_method: string;
  description: string | null;
}

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const db = await getDb();
  const res = await db.query<ExpenseCategory>('SELECT id, name, account_id FROM expense_categories WHERE is_active = true ORDER BY sort_order');
  return res.rows;
}

export async function listIncomeCategories(): Promise<IncomeCategory[]> {
  const db = await getDb();
  const res = await db.query<IncomeCategory>('SELECT id, name, account_id FROM income_categories WHERE is_active = true ORDER BY sort_order');
  return res.rows;
}

export async function listExpenses(): Promise<Expense[]> {
  const db = await getDb();
  const res = await db.query<Expense>(
    `SELECT e.id, e.doc_number, e.date::text, ec.name as category_name, e.amount, e.activity_id,
            e.payment_method, e.description, e.is_shared
     FROM expenses e LEFT JOIN expense_categories ec ON e.category_id = ec.id ORDER BY e.date DESC`
  );
  return res.rows;
}

export async function listIncomes(): Promise<Income[]> {
  const db = await getDb();
  const res = await db.query<Income>(
    `SELECT i.id, i.doc_number, i.date::text, ic.name as category_name, i.amount, i.activity_id,
            i.payment_method, i.description
     FROM incomes i LEFT JOIN income_categories ic ON i.category_id = ic.id ORDER BY i.date DESC`
  );
  return res.rows;
}

export async function createExpense(data: {
  date: string;
  categoryId: string;
  amount: number;
  activityId?: string | null;
  paymentMethod?: string;
  description?: string;
  isShared?: boolean;
  createdBy?: string | null;
}): Promise<void> {
  if (data.amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  const db = await getDb();

  // جلب حساب الفئة
  const catRes = await db.query<{ account_id: string; name: string }>('SELECT account_id, name FROM expense_categories WHERE id = $1', [data.categoryId]);
  if (catRes.rows.length === 0) throw new Error('الفئة غير موجودة');
  const accountId = catRes.rows[0].account_id ?? 'acc_admin';
  const catName = catRes.rows[0].name;

  // القيد: مدين المصروف، دائن الخزينة (نقدي) أو الموردين (آجل)
  const creditAccount = data.paymentMethod === 'credit' ? 'acc_ap' : 'acc_cash';
  await createJournalEntry({
    date: data.date,
    description: data.description ?? `مصروف: ${catName}`,
    referenceType: 'expense',
    activityId: data.activityId,
    lines: [
      { accountId, debit: data.amount, credit: 0 },
      { accountId: creditAccount, debit: 0, credit: data.amount },
    ],
    createdBy: data.createdBy,
  });

  await db.query(
    `INSERT INTO expenses (doc_number, date, category_id, account_id, amount, activity_id, payment_method, description, is_shared)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [Date.now().toString(), data.date, data.categoryId, accountId, toCents(data.amount), data.activityId ?? null,
     data.paymentMethod ?? 'cash', data.description ?? null, data.isShared ?? false]
  );
}

export async function createIncome(data: {
  date: string;
  categoryId: string;
  amount: number;
  activityId?: string | null;
  paymentMethod?: string;
  description?: string;
  createdBy?: string | null;
}): Promise<void> {
  if (data.amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  const db = await getDb();

  const catRes = await db.query<{ account_id: string; name: string }>('SELECT account_id, name FROM income_categories WHERE id = $1', [data.categoryId]);
  if (catRes.rows.length === 0) throw new Error('الفئة غير موجودة');
  const accountId = catRes.rows[0].account_id ?? 'acc_sales';
  const catName = catRes.rows[0].name;

  const debitAccount = data.paymentMethod === 'credit' ? 'acc_ar' : 'acc_cash';
  await createJournalEntry({
    date: data.date,
    description: data.description ?? `إيراد: ${catName}`,
    referenceType: 'income',
    activityId: data.activityId,
    lines: [
      { accountId: debitAccount, debit: data.amount, credit: 0 },
      { accountId, debit: 0, credit: data.amount },
    ],
    createdBy: data.createdBy,
  });

  await db.query(
    `INSERT INTO incomes (doc_number, date, category_id, account_id, amount, activity_id, payment_method, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [Date.now().toString(), data.date, data.categoryId, accountId, toCents(data.amount), data.activityId ?? null,
     data.paymentMethod ?? 'cash', data.description ?? null]
  );
}
