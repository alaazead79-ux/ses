import { getDb, toCents } from '@/db/db';
import {
  getDesktopApi,
  type DesktopInvoiceItemRow,
  type DesktopInvoiceRow,
} from '@/lib/electronBridge';
import { createJournalEntry, nextDocNumber } from './accountingService';
import { recordPartyTransaction } from './partyService';
import { listProducts } from './inventoryService';

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
  returnedQuantity?: number;
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

export function toPiastres(pounds: number): number {
  return Math.round(pounds * 100);
}

function fromDesktopItem(item: DesktopInvoiceItemRow): InvoiceItem {
  return {
    id: item.id,
    invoice_id: item.invoice_id,
    product_id: item.product_id,
    description: item.description,
    quantity: item.quantity_milli / 1000,
    returnedQuantity: item.returned_milli / 1000,
    unit: item.unit,
    unit_price: item.unit_price,
    discount: item.discount,
    total: item.total,
  };
}

function fromDesktopInvoice(row: DesktopInvoiceRow): Invoice {
  return {
    id: row.id,
    doc_number: row.doc_number,
    date: row.date,
    doc_type: row.doc_type,
    party_id: row.party_id,
    party_name: row.party_name,
    activity_id: row.activity_id,
    payment_method: row.payment_method,
    status: row.status,
    subtotal: row.subtotal,
    discount: row.discount,
    total: row.total,
    paid_amount: row.paid_amount,
    notes: row.notes,
    items: row.items.map(fromDesktopItem),
  };
}

export async function listInvoices(docType?: string): Promise<Invoice[]> {
  const desktop = getDesktopApi();
  if (desktop) {
    const types = docType ? [docType] : ['sales', 'purchase'];
    const lists = await Promise.all(types.map((type) => desktop.farm.invoices.list({ docType: type as 'sales' | 'purchase' })));
    return lists.flat().map(fromDesktopInvoice).sort((a, b) => (a.date === b.date ? b.doc_number.localeCompare(a.doc_number) : b.date.localeCompare(a.date)));
  }

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
  items: { productId?: string; description: string; quantity: number; unit: string; unitPrice: number; discount: number }[];
  discount: number;
  notes?: string;
  createdBy?: string | null;
  cashboxId?: string;
  paidNow?: number;
}): Promise<{ id: string; docNumber: string }> {
  const desktop = getDesktopApi();
  if (desktop) {
    if (data.docType !== 'sales' && data.docType !== 'purchase') throw new Error('المرتجع يُسجَّل من الفاتورة الأصلية');
    const result = await desktop.farm.invoices.create({
      docType: data.docType,
      date: data.date,
      partyId: data.partyId,
      activityId: data.activityId ?? null,
      paymentMethod: data.paymentMethod,
      cashboxId: data.cashboxId,
      paidNow: data.paidNow === undefined ? undefined : toPiastres(data.paidNow),
      discount: toPiastres(data.discount),
      notes: data.notes,
      items: data.items.map((item) => {
        if (!item.productId) throw new Error('اختر الصنف من المخزون لكل بند');
        return { productId: item.productId, quantity: item.quantity, unitPrice: toPiastres(item.unitPrice), discount: toPiastres(item.discount) };
      }),
    });
    return { id: result.id, docNumber: result.docNumber };
  }

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

export interface ReturnInput {
  invoice: Invoice;
  date: string;
  reason?: string;
  items: { productId: string; quantity: number }[];
}

export async function createReturn(input: ReturnInput): Promise<{ id: string; docNumber: string }> {
  const desktop = getDesktopApi();
  if (!desktop) throw new Error('المرتجعات متاحة من تطبيق سطح المكتب فقط');
  const { invoice } = input;
  if (invoice.doc_type !== 'sales' && invoice.doc_type !== 'purchase') throw new Error('نوع الفاتورة لا يقبل مرتجعًا');
  const result = await desktop.farm.invoices.return({
    returnType: invoice.doc_type === 'sales' ? 'sales_return' : 'purchase_return',
    invoiceId: invoice.id,
    date: input.date,
    reason: input.reason,
    items: input.items,
  });
  return { id: result.id, docNumber: result.docNumber };
}

export async function recordPayment(data: {
  invoiceId?: string;
  cashboxId?: string;
  partyId: string;
  date: string;
  amount: number;
  paymentMethod: string;
  direction: 'inbound' | 'outbound';
  description?: string;
  createdBy?: string | null;
}): Promise<void> {
  const desktop = getDesktopApi();
  if (desktop) {
    if (!data.invoiceId) throw new Error('اختر الفاتورة المراد سدادها');
    if (!data.cashboxId) throw new Error('اختر الخزينة');
    await desktop.farm.invoices.pay({
      invoiceId: data.invoiceId,
      date: data.date,
      amount: toPiastres(data.amount),
      method: data.paymentMethod === 'transfer' ? 'transfer' : 'cash',
      cashboxId: data.cashboxId,
    });
    return;
  }

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

export interface SellableProduct {
  id: string;
  name: string;
  unit: string;
  quantity: number;
}

export interface CashboxOption {
  id: string;
  name: string;
  balance: number;
}

export async function listSellableProducts(): Promise<SellableProduct[]> {
  const desktop = getDesktopApi();
  if (desktop) {
    const rows = await desktop.farm.products.list();
    return rows.map((row) => ({ id: row.id, name: row.name, unit: row.unit, quantity: row.quantity_milli / 1000 }));
  }
  const products = await listProducts();
  return products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, quantity: p.quantity }));
}

export async function listCashboxOptions(): Promise<CashboxOption[]> {
  const desktop = getDesktopApi();
  if (!desktop) return [];
  const rows = await desktop.farm.treasury.cashboxes() as { id: string; name: string; balance: number; is_active: boolean }[];
  return rows.filter((box) => box.is_active).map((box) => ({ id: box.id, name: box.name, balance: box.balance }));
}

export async function cancelInvoice(invoiceId: string, date: string): Promise<{ id: string; reversalEntryNumber: string | null }> {
  const desktop = getDesktopApi();
  if (!desktop) throw new Error('إلغاء الفواتير متاح من تطبيق سطح المكتب فقط');
  return desktop.farm.invoices.cancel({ invoiceId, date });
}

function docTypeLabel(type: string): string {
  return { sales: 'فاتورة مبيعات', purchase: 'فاتورة مشتريات', sales_return: 'مرتجع مبيعات', purchase_return: 'مرتجع مشتريات' }[type] ?? type;
}
