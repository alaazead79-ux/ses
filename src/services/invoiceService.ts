import { getDb, toCents } from '@/db/db';
import { createJournalEntry, nextDocNumber } from './accountingService';
import { recordPartyTransaction } from './partyService';

export interface Invoice {
  id: string;
  doc_number: string;
  date: string;
  doc_type: string;
  party_id: string | null;
  party_name: string | null;
  activity_id: string | null;
  payment_method: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  paid_amount: number;
  notes: string | null;
  items: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount: number;
  total: number;
}

const ACCOUNT_IDS = {
  cash: 'acc_cash',
  ar: 'acc_ar',
  ap: 'acc_ap',
  sales: 'acc_sales',
  salesReturns: 'acc_sales_returns',
  purchaseReturns: 'acc_purchase_returns',
  cogs: 'acc_cogs',
  inventory: 'acc_inventory',
};

export async function listInvoices(docType?: string): Promise<Invoice[]> {
  const db = await getDb();
  let query = `
    SELECT i.id, i.doc_number, i.date::text, i.doc_type, i.party_id, p.name as party_name,
           i.activity_id, i.payment_method, i.status, i.subtotal, i.discount, i.total, i.paid_amount, i.notes
    FROM invoices i LEFT JOIN parties p ON i.party_id = p.id`;
  const params: unknown[] = [];
  if (docType) { params.push(docType); query += ` WHERE i.doc_type = $1`; }
  query += ' ORDER BY i.date DESC, i.doc_number DESC';

  const res = await db.query<{
    id: string; doc_number: string; date: string; doc_type: string; party_id: string | null;
    party_name: string | null; activity_id: string | null; payment_method: string;
    status: string; subtotal: number; discount: number; total: number; paid_amount: number; notes: string | null;
  }>(query, params);

  const invoices: Invoice[] = [];
  for (const r of res.rows) {
    const items = await db.query<{ id: string; invoice_id: string; product_id: string | null; description: string | null; quantity: number; unit: string | null; unit_price: number; discount: number; total: number }>(
      'SELECT id, invoice_id, product_id, description, quantity, unit, unit_price, discount, total FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
      [r.id]
    );
    invoices.push({ ...r, items: items.rows });
  }
  return invoices;
}

export async function createInvoice(data: {
  date: string;
  docType: 'sales' | 'purchase' | 'sales_return' | 'purchase_return';
  partyId: string;
  activityId?: string | null;
  paymentMethod: string;
  items: { description: string; quantity: number; unit: string; unitPrice: number; discount: number }[];
  discount: number;
  notes?: string;
  createdBy?: string | null;
}): Promise<{ id: string; docNumber: string }> {
  const db = await getDb();

  // حساب الإجماليات (بالجنيه)
  const subtotal = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const itemsDiscount = data.items.reduce((s, i) => s + i.discount, 0);
  const total = subtotal - itemsDiscount - data.discount;
  if (total <= 0) throw new Error('إجمالي الفاتورة يجب أن يكون أكبر من صفر');

  const docNumber = await nextDocNumber(data.docType === 'sales' ? 'sales_invoice'
    : data.docType === 'purchase' ? 'purchase_invoice'
    : data.docType === 'sales_return' ? 'sales_return'
    : 'purchase_return');

  // إنشاء القيد المحاسبي
  const isCash = data.paymentMethod === 'cash';

  let lines: { accountId: string; debit: number; credit: number }[];
  if (data.docType === 'sales') {
    if (isCash) lines = [{ accountId: ACCOUNT_IDS.cash, debit: total, credit: 0 }, { accountId: ACCOUNT_IDS.sales, debit: 0, credit: total }];
    else lines = [{ accountId: ACCOUNT_IDS.ar, debit: total, credit: 0 }, { accountId: ACCOUNT_IDS.sales, debit: 0, credit: total }];
  } else if (data.docType === 'purchase') {
    if (isCash) lines = [{ accountId: ACCOUNT_IDS.cogs, debit: total, credit: 0 }, { accountId: ACCOUNT_IDS.cash, debit: 0, credit: total }];
    else lines = [{ accountId: ACCOUNT_IDS.cogs, debit: total, credit: 0 }, { accountId: ACCOUNT_IDS.ap, debit: 0, credit: total }];
  } else if (data.docType === 'sales_return') {
    if (isCash) lines = [{ accountId: ACCOUNT_IDS.salesReturns, debit: total, credit: 0 }, { accountId: ACCOUNT_IDS.cash, debit: 0, credit: total }];
    else lines = [{ accountId: ACCOUNT_IDS.salesReturns, debit: total, credit: 0 }, { accountId: ACCOUNT_IDS.ar, debit: 0, credit: total }];
  } else {
    // purchase_return
    if (isCash) lines = [{ accountId: ACCOUNT_IDS.cash, debit: total, credit: 0 }, { accountId: ACCOUNT_IDS.purchaseReturns, debit: 0, credit: total }];
    else lines = [{ accountId: ACCOUNT_IDS.ap, debit: total, credit: 0 }, { accountId: ACCOUNT_IDS.purchaseReturns, debit: 0, credit: total }];
  }

  const journal = await createJournalEntry({
    date: data.date,
    description: `${docTypeLabel(data.docType)} ${docNumber}`,
    referenceType: 'invoice',
    activityId: data.activityId,
    lines,
    createdBy: data.createdBy,
  });

  // حفظ الفاتورة
  const invRes = await db.query<{ id: string }>(
    `INSERT INTO invoices (doc_number, date, doc_type, party_id, activity_id, payment_method, status, subtotal, discount, total, paid_amount, notes, journal_entry_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [docNumber, data.date, data.docType, data.partyId, data.activityId ?? null, data.paymentMethod,
     toCents(subtotal), toCents(itemsDiscount + data.discount), toCents(total),
     isCash ? toCents(total) : 0, data.notes ?? null, journal.id, data.createdBy ?? null]
  );
  const invoiceId = invRes.rows[0].id;

  // حفظ البنود
  for (const item of data.items) {
    const itemTotal = item.quantity * item.unitPrice - item.discount;
    await db.query(
      `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit, unit_price, discount, total)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)`,
      [invoiceId, item.description, item.quantity, item.unit, toCents(item.unitPrice), toCents(item.discount), toCents(itemTotal)]
    );
  }

  // حركة الطرف
  if (data.docType === 'sales' && !isCash) {
    await recordPartyTransaction({ partyId: data.partyId, date: data.date, type: 'invoice', referenceType: 'invoice', referenceId: invoiceId, debit: total, description: `فاتورة مبيعات ${docNumber}` });
  } else if (data.docType === 'purchase' && !isCash) {
    await recordPartyTransaction({ partyId: data.partyId, date: data.date, type: 'invoice', referenceType: 'invoice', referenceId: invoiceId, credit: total, description: `فاتورة مشتريات ${docNumber}` });
  } else if (data.docType === 'sales_return' && !isCash) {
    await recordPartyTransaction({ partyId: data.partyId, date: data.date, type: 'return', referenceType: 'invoice', referenceId: invoiceId, credit: total, description: `مرتجع مبيعات ${docNumber}` });
  } else if (data.docType === 'purchase_return' && !isCash) {
    await recordPartyTransaction({ partyId: data.partyId, date: data.date, type: 'return', referenceType: 'invoice', referenceId: invoiceId, debit: total, description: `مرتجع مشتريات ${docNumber}` });
  }

  return { id: invoiceId, docNumber };
}

export async function recordPayment(data: {
  invoiceId?: string;
  partyId: string;
  date: string;
  amount: number;
  paymentMethod: string;
  direction: 'inbound' | 'outbound';
  description?: string;
  createdBy?: string | null;
}): Promise<void> {
  const db = await getDb();
  const docNumber = await nextDocNumber('payment');
  const amountCents = toCents(data.amount);

  // القيد: تحصيل من العميل — مدين الخزينة، دائن العميل
  // صرف للمورد — مدين المورد، دائن الخزينة
  const lines = data.direction === 'inbound'
    ? [{ accountId: ACCOUNT_IDS.cash, debit: data.amount, credit: 0 }, { accountId: ACCOUNT_IDS.ar, debit: 0, credit: data.amount }]
    : [{ accountId: ACCOUNT_IDS.ap, debit: data.amount, credit: 0 }, { accountId: ACCOUNT_IDS.cash, debit: 0, credit: data.amount }];

  const journal = await createJournalEntry({
    date: data.date,
    description: data.description ?? `سند ${data.direction === 'inbound' ? 'قبض' : 'صرف'} ${docNumber}`,
    referenceType: 'payment',
    lines,
    createdBy: data.createdBy,
  });

  await db.query(
    `INSERT INTO payments (doc_number, date, invoice_id, party_id, amount, payment_method, direction, description, journal_entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [docNumber, data.date, data.invoiceId ?? null, data.partyId, amountCents, data.paymentMethod, data.direction, data.description ?? null, journal.id]
  );

  // تحديث المبلغ المدفوع في الفاتورة
  if (data.invoiceId) {
    await db.query('UPDATE invoices SET paid_amount = paid_amount + $1, updated_at = now() WHERE id = $2', [amountCents, data.invoiceId]);
  }

  // حركة الطرف
  await recordPartyTransaction({
    partyId: data.partyId, date: data.date, type: 'payment', referenceType: 'payment', referenceId: docNumber,
    debit: data.direction === 'outbound' ? data.amount : 0,
    credit: data.direction === 'inbound' ? data.amount : 0,
    description: data.description ?? `سداد ${docNumber}`,
  });
}

function docTypeLabel(type: string): string {
  return { sales: 'فاتورة مبيعات', purchase: 'فاتورة مشتريات', sales_return: 'مرتجع مبيعات', purchase_return: 'مرتجع مشتريات' }[type] ?? type;
}
