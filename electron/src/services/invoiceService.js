const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { assertIsoDate, optionalText, toMilli, toPiastres, mulDivRound } = require('../domain/money');
const { nextDocNumber, postJournalEntry } = require('../domain/postingEngine');
const { receiveStock, issueStock } = require('./inventoryService');
const { requireActiveCashbox, cashboxBalance, insertCashTransaction } = require('./treasuryService');

const INVOICE_METHODS = ['cash', 'credit', 'transfer', 'check'];
const PAYMENT_METHODS = ['cash', 'transfer'];

function readParty(db, partyId, docType) {
  const party = db.prepare('SELECT id, name, type FROM parties WHERE id = ?').get(partyId);
  if (!party) throw new UserFacingError('الطرف غير موجود');
  const allowed = docType === 'sales' ? ['customer', 'both'] : ['supplier', 'both'];
  if (!allowed.includes(party.type)) {
    throw new UserFacingError(docType === 'sales' ? 'اختر عميلًا لفاتورة المبيعات' : 'اختر موردًا لفاتورة المشتريات');
  }
  return party;
}

function readCashbox(db, cashboxId) {
  const box = db.prepare('SELECT id, account_id, is_active FROM cashboxes WHERE id = ?').get(String(cashboxId ?? ''));
  if (!box) throw new UserFacingError('الخزينة غير موجودة');
  if (box.is_active !== 1) throw new UserFacingError('الخزينة غير مفعلة');
  return box;
}

function readPostedInvoice(db, invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(String(invoiceId ?? ''));
  if (!invoice) throw new UserFacingError('الفاتورة غير موجودة');
  if (invoice.status !== 'posted') throw new UserFacingError('الفاتورة ملغاة');
  return invoice;
}

function parseItems(db, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new UserFacingError('أضف صنفًا واحدًا على الأقل');
  return rawItems.map((raw) => {
    const product = db.prepare('SELECT id, name, unit, is_active FROM products WHERE id = ?').get(String(raw?.productId ?? ''));
    if (!product || product.is_active !== 1) throw new UserFacingError('الصنف غير موجود');
    const quantityMilli = toMilli(raw?.quantity, 'الكمية');
    const unitPrice = toPiastres(raw?.unitPrice, 'سعر الوحدة', { allowZero: true });
    const lineDiscount = toPiastres(raw?.discount ?? 0, 'خصم السطر', { allowZero: true });
    const gross = mulDivRound(quantityMilli, unitPrice, 1000);
    if (lineDiscount > gross) throw new UserFacingError('الخصم أكبر من قيمة السطر');
    return { product, quantityMilli, unitPrice, lineDiscount, total: gross - lineDiscount };
  });
}

function resolvePaidNow(method, requested, total) {
  if (method === 'credit' || method === 'check') {
    if (requested) throw new UserFacingError('لا يمكن تسجيل دفعة فورية لهذه الطريقة');
    return 0;
  }
  const paid = requested === undefined || requested === null ? total : toPiastres(requested, 'المبلغ المدفوع', { allowZero: true });
  if (paid > total) throw new UserFacingError('المبلغ المدفوع أكبر من الإجمالي');
  return paid;
}

// قيد السداد: مبيعات = تحصيل من العميل، مشتريات = دفع للمورد
function paymentLines(docType, cashAccountId, amount) {
  return docType === 'sales'
    ? [{ accountId: cashAccountId, debit: amount }, { accountId: 'acc_ar', credit: amount }]
    : [{ accountId: 'acc_ap', debit: amount }, { accountId: cashAccountId, credit: amount }];
}

function insertPaymentRecords(db, {
  date, docType, invoiceId, partyId, amount, cashbox, method, journalEntryId, userId, paymentId, docNumber,
}) {
  const inbound = docType === 'sales';
  db.prepare(`
    INSERT INTO payments (id, doc_number, date, invoice_id, party_id, amount, payment_method, cashbox_id, direction, journal_entry_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(paymentId, docNumber, date, invoiceId, partyId, amount, method, cashbox.id,
    inbound ? 'inbound' : 'outbound', journalEntryId, userId);
  db.prepare(`
    INSERT INTO cash_transactions (id, doc_number, date, type, direction, cashbox_id, amount, party_id, invoice_id,
      payment_method, source_type, source_id, journal_entry_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'payment', ?, ?, ?)
  `).run(crypto.randomUUID(), docNumber, date, inbound ? 'receipt' : 'payment', inbound ? 'in' : 'out',
    cashbox.id, amount, partyId, invoiceId, method, paymentId, journalEntryId, userId);
  db.prepare(`
    INSERT INTO party_transactions (id, party_id, date, type, reference_type, reference_id, debit, credit, description)
    VALUES (?, ?, ?, 'payment', 'payment', ?, ?, ?, ?)
  `).run(crypto.randomUUID(), partyId, date, paymentId, inbound ? 0 : amount, inbound ? amount : 0, docNumber);
}

function createInvoice(db, userId, input) {
  const docType = input?.docType;
  if (docType !== 'sales' && docType !== 'purchase') throw new UserFacingError('نوع الفاتورة غير صالح');
  const date = assertIsoDate(input?.date);
  const party = readParty(db, String(input?.partyId ?? ''), docType);
  const method = input?.paymentMethod ?? 'cash';
  if (!INVOICE_METHODS.includes(method)) throw new UserFacingError('طريقة الدفع غير صالحة');
  const activityId = input?.activityId ? String(input.activityId) : null;
  if (activityId && !db.prepare('SELECT id FROM activities WHERE id = ?').get(activityId)) {
    throw new UserFacingError('النشاط غير موجود');
  }
  const items = parseItems(db, input?.items);
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const discount = toPiastres(input?.discount ?? 0, 'خصم الفاتورة', { allowZero: true });
  const total = subtotal - discount;
  if (total <= 0) throw new UserFacingError('إجمالي الفاتورة يجب أن يكون أكبر من صفر');
  const paidNow = resolvePaidNow(method, input?.paidNow, total);
  const cashbox = paidNow > 0 ? readCashbox(db, input?.cashboxId) : null;
  const notes = optionalText(input?.notes, 500);

  return db.transaction(() => {
    const invoiceId = crypto.randomUUID();
    const docNumber = nextDocNumber(db, docType === 'sales' ? 'sales_invoice' : 'purchase_invoice');

    const costed = items.map((item) => {
      if (docType === 'sales') {
        const issued = issueStock(db, {
          date, productId: item.product.id, quantityMilli: item.quantityMilli, type: 'sale',
          referenceType: 'sales_invoice', referenceId: invoiceId, activityId, userId,
        });
        return { ...item, unitCost: issued.unitCost, costTotal: issued.totalCost };
      }
      const received = receiveStock(db, {
        date, productId: item.product.id, quantityMilli: item.quantityMilli, totalCost: item.total,
        type: 'purchase', referenceType: 'purchase_invoice', referenceId: invoiceId, activityId, userId,
      });
      return { ...item, unitCost: received.unitCost, costTotal: 0 };
    });
    const cogs = costed.reduce((sum, item) => sum + item.costTotal, 0);

    const lines = docType === 'sales'
      ? [{ accountId: 'acc_ar', debit: total }, { accountId: 'acc_sales', credit: total }]
      : [{ accountId: 'acc_inventory', debit: total }, { accountId: 'acc_ap', credit: total }];
    if (docType === 'sales' && cogs > 0) {
      lines.push({ accountId: 'acc_cogs', debit: cogs }, { accountId: 'acc_inventory', credit: cogs });
    }
    if (paidNow > 0) lines.push(...paymentLines(docType, cashbox.account_id, paidNow));

    const entry = postJournalEntry(db, {
      date, description: docNumber, referenceType: docType === 'sales' ? 'sales_invoice' : 'purchase_invoice',
      referenceId: invoiceId, activityId, lines, userId,
    });

    db.prepare(`
      INSERT INTO invoices (id, doc_number, date, doc_type, party_id, activity_id, payment_method, status,
        subtotal, discount, total, paid_amount, cost_total, notes, journal_entry_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceId, docNumber, date, docType, party.id, activityId, method, subtotal, discount, total,
      paidNow, cogs, notes, entry.id, userId);

    const insertItem = db.prepare(`
      INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity_milli, unit, unit_price, discount, total, unit_cost, cost_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of costed) {
      insertItem.run(crypto.randomUUID(), invoiceId, item.product.id, item.product.name, item.quantityMilli,
        item.product.unit, item.unitPrice, item.lineDiscount, item.total, item.unitCost, item.costTotal);
    }

    db.prepare(`
      INSERT INTO party_transactions (id, party_id, date, type, reference_type, reference_id, debit, credit, description)
      VALUES (?, ?, ?, 'invoice', 'invoice', ?, ?, ?, ?)
    `).run(crypto.randomUUID(), party.id, date, invoiceId, docType === 'sales' ? total : 0,
      docType === 'sales' ? 0 : total, docNumber);

    if (paidNow > 0) {
      insertPaymentRecords(db, {
        date, docType, invoiceId, partyId: party.id, amount: paidNow, cashbox, method: method === 'transfer' ? 'transfer' : 'cash',
        journalEntryId: entry.id, userId, paymentId: crypto.randomUUID(), docNumber: nextDocNumber(db, docType === 'sales' ? 'receipt' : 'payment'),
      });
    }

    audit(db, { userId, action: 'create', module: 'sales', entityId: invoiceId, entityType: 'invoice', details: { docNumber, total } });
    return { id: invoiceId, docNumber, total, paidAmount: paidNow };
  })();
}

function recordPayment(db, userId, input) {
  const invoice = readPostedInvoice(db, input?.invoiceId);
  const date = assertIsoDate(input?.date);
  const amount = toPiastres(input?.amount, 'المبلغ');
  const outstanding = invoice.total - invoice.paid_amount;
  if (amount > outstanding) throw new UserFacingError(`المبلغ أكبر من المتبقي على الفاتورة (${outstanding})`);
  const method = input?.method ?? 'cash';
  if (!PAYMENT_METHODS.includes(method)) throw new UserFacingError('طريقة الدفع غير صالحة');
  const cashbox = readCashbox(db, input?.cashboxId);
  const docType = invoice.doc_type;

  return db.transaction(() => {
    const paymentId = crypto.randomUUID();
    const docNumber = nextDocNumber(db, docType === 'sales' ? 'receipt' : 'payment');
    const entry = postJournalEntry(db, {
      date, description: docNumber, referenceType: 'payment', referenceId: paymentId, lines: paymentLines(docType, cashbox.account_id, amount), userId,
    });
    insertPaymentRecords(db, {
      date, docType, invoiceId: invoice.id, partyId: invoice.party_id, amount, cashbox, method,
      journalEntryId: entry.id, userId, paymentId, docNumber,
    });
    db.prepare('UPDATE invoices SET paid_amount = paid_amount + ?, updated_at = ? WHERE id = ?')
      .run(amount, new Date().toISOString(), invoice.id);
    audit(db, { userId, action: 'create', module: 'sales', entityId: paymentId, entityType: 'payment', details: { docNumber, amount } });
    return { id: paymentId, docNumber };
  })();
}

function returnTypeFor(docType) {
  return docType === 'sales' ? 'sales_return' : 'purchase_return';
}

function returnedQuantity(db, invoiceId, returnType, productId) {
  return db.prepare(`
    SELECT COALESCE(SUM(ri.quantity_milli), 0) AS qty
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE r.invoice_id = ? AND r.return_type = ? AND ri.product_id = ?
  `).get(invoiceId, returnType, productId).qty;
}

// المرتجع يُسعَّر من الفاتورة الأصلية وليس من مدخلات الشاشة
function createReturn(db, userId, input) {
  const returnType = input?.returnType;
  if (returnType !== 'sales_return' && returnType !== 'purchase_return') throw new UserFacingError('نوع المرتجع غير صالح');
  const docType = returnType === 'sales_return' ? 'sales' : 'purchase';
  const invoice = readPostedInvoice(db, input?.invoiceId);
  if (invoice.doc_type !== docType) throw new UserFacingError('الفاتورة لا تطابق نوع المرتجع');
  const date = assertIsoDate(input?.date);
  const reason = optionalText(input?.reason, 300);
  if (!Array.isArray(input?.items) || input.items.length === 0) throw new UserFacingError('أضف صنفًا للمرتجع');

  const lines = input.items.map((raw) => {
    const productId = String(raw?.productId ?? '');
    const quantityMilli = toMilli(raw?.quantity, 'الكمية المرتجعة');
    const invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? AND product_id = ?').all(invoice.id, productId);
    if (invoiceItems.length === 0) throw new UserFacingError('الصنف غير موجود في الفاتورة');
    const soldQty = invoiceItems.reduce((s, i) => s + i.quantity_milli, 0);
    const soldTotal = invoiceItems.reduce((s, i) => s + i.total, 0);
    const soldCost = invoiceItems.reduce((s, i) => s + i.cost_total, 0);
    const alreadyReturned = returnedQuantity(db, invoice.id, returnType, productId);
    const remaining = soldQty - alreadyReturned;
    if (quantityMilli > remaining) {
      throw new UserFacingError(`الكمية المرتجعة تتجاوز المتبقي في الفاتورة (${remaining / 1000})`);
    }
    return {
      productId,
      quantityMilli,
      total: mulDivRound(quantityMilli, soldTotal, soldQty),
      invoiceCost: mulDivRound(quantityMilli, soldCost, soldQty),
    };
  });

  return db.transaction(() => {
    const returnId = crypto.randomUUID();
    const docNumber = nextDocNumber(db, returnType);
    const total = lines.reduce((s, l) => s + l.total, 0);

    const costed = lines.map((line) => {
      if (returnType === 'sales_return') {
        receiveStock(db, {
          date, productId: line.productId, quantityMilli: line.quantityMilli, totalCost: line.invoiceCost,
          type: 'sale_return', referenceType: 'sales_return', referenceId: returnId, userId,
        });
        return { ...line, cost: line.invoiceCost };
      }
      const issued = issueStock(db, {
        date, productId: line.productId, quantityMilli: line.quantityMilli, type: 'purchase_return',
        referenceType: 'purchase_return', referenceId: returnId, userId,
      });
      return { ...line, cost: issued.totalCost };
    });
    const cost = costed.reduce((s, l) => s + l.cost, 0);

    let journalLines;
    if (returnType === 'sales_return') {
      journalLines = [
        { accountId: 'acc_sales_returns', debit: total }, { accountId: 'acc_ar', credit: total },
        { accountId: 'acc_inventory', debit: cost }, { accountId: 'acc_cogs', credit: cost },
      ];
    } else {
      const difference = total - cost;
      journalLines = [{ accountId: 'acc_ap', debit: total }, { accountId: 'acc_inventory', credit: cost }];
      if (difference > 0) journalLines.push({ accountId: 'acc_purchase_returns', credit: difference });
      if (difference < 0) journalLines.push({ accountId: 'acc_purchase_returns', debit: -difference });
    }
    const entry = postJournalEntry(db, {
      date, description: docNumber, referenceType: returnType, referenceId: returnId,
      activityId: invoice.activity_id, lines: journalLines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0), userId,
    });

    db.prepare(`
      INSERT INTO returns (id, doc_number, date, return_type, invoice_id, party_id, activity_id, payment_method, total, cost_total, reason, journal_entry_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'credit', ?, ?, ?, ?, ?)
    `).run(returnId, docNumber, date, returnType, invoice.id, invoice.party_id, invoice.activity_id, total, cost, reason, entry.id, userId);

    const insertItem = db.prepare(`
      INSERT INTO return_items (id, return_id, product_id, quantity_milli, unit_price, total, unit_cost, cost_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of costed) {
      insertItem.run(crypto.randomUUID(), returnId, line.productId, line.quantityMilli,
        mulDivRound(line.total, 1000, line.quantityMilli), line.total, mulDivRound(line.cost, 1000, line.quantityMilli), line.cost);
    }

    db.prepare(`
      INSERT INTO party_transactions (id, party_id, date, type, reference_type, reference_id, debit, credit, description)
      VALUES (?, ?, ?, 'return', ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), invoice.party_id, date, returnType, returnId,
      returnType === 'sales_return' ? 0 : total, returnType === 'sales_return' ? total : 0, docNumber);

    audit(db, { userId, action: 'create', module: 'sales', entityId: returnId, entityType: 'return', details: { docNumber, total } });
    return { id: returnId, docNumber, total, cost };
  })();
}

function listInvoices(db, docType) {
  if (docType !== 'sales' && docType !== 'purchase') throw new UserFacingError('نوع الفاتورة غير صالح');
  const itemsStmt = db.prepare(`
    SELECT id, invoice_id, product_id, description, quantity_milli, unit, unit_price, discount, total
    FROM invoice_items WHERE invoice_id = ? ORDER BY rowid
  `);
  return db.prepare(`
    SELECT i.id, i.doc_number, i.date, i.doc_type, i.party_id, i.activity_id, i.subtotal, i.discount, i.total,
      i.paid_amount, i.total - i.paid_amount AS outstanding, i.payment_method, i.status, i.notes, p.name AS party_name
    FROM invoices i JOIN parties p ON p.id = i.party_id
    WHERE i.doc_type = ? ORDER BY i.date DESC, i.doc_number DESC LIMIT 200
  `).all(docType).map((row) => ({
    ...row,
    items: itemsStmt.all(row.id).map((item) => ({
      ...item,
      returned_milli: item.product_id ? returnedQuantity(db, row.id, returnTypeFor(row.doc_type), item.product_id) : 0,
    })),
  }));
}

// ما لم يُرجَع بعد من كل صنف (الكمية والتكلفة). المرتجعات السابقة قيودها قائمة ولا تُعكس مرة أخرى
function unreturnedItems(db, invoice) {
  const returnType = returnTypeFor(invoice.doc_type);
  const returnedStmt = db.prepare(`
    SELECT COALESCE(SUM(ri.quantity_milli), 0) AS quantity_milli, COALESCE(SUM(ri.cost_total), 0) AS cost_total
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE r.invoice_id = ? AND r.return_type = ? AND ri.product_id = ?
  `);
  return db.prepare(`
    SELECT product_id, SUM(quantity_milli) AS quantity_milli, SUM(cost_total) AS cost_total
    FROM invoice_items WHERE invoice_id = ? GROUP BY product_id
  `).all(invoice.id).map((row) => {
    const returned = returnedStmt.get(invoice.id, returnType, row.product_id);
    return {
      productId: row.product_id,
      quantityMilli: row.quantity_milli - returned.quantity_milli,
      costTotal: row.cost_total - returned.cost_total,
    };
  }).filter((row) => row.quantityMilli > 0);
}

// الإلغاء يعكس المتبقي فقط بعد المرتجعات، والسدادات كما هي. البضاعة المتبقية تعود (مبيعات) أو تُصرف (مشتريات).
// المبيعات: النقد المسترد يُقيَّد بالرصيد الفعلي للخزينة، والباقي يبقى رصيدًا دائنًا للعميل ولا تُنشأ حركة نقدية سالبة.
function cancelInvoice(db, userId, input) {
  const invoice = readPostedInvoice(db, input?.invoiceId);
  const date = assertIsoDate(input?.date);
  const isSales = invoice.doc_type === 'sales';

  const returned = db.prepare('SELECT COALESCE(SUM(total), 0) AS total FROM returns WHERE invoice_id = ?').get(invoice.id);
  const remainingTotal = invoice.total - returned.total;
  if (remainingTotal < 0) throw new UserFacingError('لا يمكن إلغاء هذه الفاتورة لأن المرتجعات تتجاوز قيمتها المتبقية');
  const remainingItems = unreturnedItems(db, invoice);
  const remainingCost = remainingItems.reduce((sum, item) => sum + item.costTotal, 0);
  const originalEntry = db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(invoice.journal_entry_id);
  if (!originalEntry || originalEntry.status !== 'posted') throw new UserFacingError('لا يمكن إلغاء هذه الفاتورة');

  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY rowid').all(invoice.id);
  const availableCash = new Map();
  const refunds = payments.map((payment) => {
    const box = requireActiveCashbox(db, payment.cashbox_id);
    if (!isSales) return { payment, box, refund: payment.amount, owed: 0 };
    if (!availableCash.has(box.id)) availableCash.set(box.id, Math.max(0, cashboxBalance(db, box.id)));
    const refund = Math.min(payment.amount, availableCash.get(box.id));
    availableCash.set(box.id, availableCash.get(box.id) - refund);
    return { payment, box, refund, owed: payment.amount - refund };
  });

  return db.transaction(() => {
    const cancelledAt = new Date().toISOString();
    let stockValue = 0;
    for (const item of remainingItems) {
      if (isSales) {
        receiveStock(db, {
          date, productId: item.productId, quantityMilli: item.quantityMilli, totalCost: item.costTotal,
          type: 'sale_return', referenceType: 'sales_invoice_cancel', referenceId: invoice.id, userId,
        });
      } else {
        const issued = issueStock(db, {
          date, productId: item.productId, quantityMilli: item.quantityMilli, type: 'purchase_return',
          referenceType: 'purchase_invoice_cancel', referenceId: invoice.id, userId,
        });
        stockValue += issued.totalCost;
      }
    }

    const reversal = [];
    if (isSales) {
      reversal.push({ accountId: 'acc_sales', debit: remainingTotal, credit: 0 }, { accountId: 'acc_ar', debit: 0, credit: remainingTotal });
      reversal.push({ accountId: 'acc_inventory', debit: remainingCost, credit: 0 }, { accountId: 'acc_cogs', debit: 0, credit: remainingCost });
    } else {
      reversal.push({ accountId: 'acc_ap', debit: remainingTotal, credit: 0 }, { accountId: 'acc_inventory', debit: 0, credit: stockValue });
      const difference = remainingTotal - stockValue;
      if (difference > 0) reversal.push({ accountId: 'acc_purchase_returns', debit: 0, credit: difference });
      if (difference < 0) reversal.push({ accountId: 'acc_purchase_returns', debit: -difference, credit: 0 });
    }
    for (const { payment, box, refund } of refunds) {
      if (isSales) {
        if (refund > 0) reversal.push({ accountId: box.account_id, debit: 0, credit: refund }, { accountId: 'acc_ar', debit: refund, credit: 0 });
      } else {
        reversal.push({ accountId: box.account_id, debit: payment.amount, credit: 0 }, { accountId: 'acc_ap', debit: 0, credit: payment.amount });
      }
    }

    const lines = reversal.filter((line) => line.debit > 0 || line.credit > 0);
    const entry = lines.length > 0 ? postJournalEntry(db, {
      date,
      description: `إلغاء ${invoice.doc_number}`,
      referenceType: 'invoice_cancel',
      referenceId: invoice.id,
      activityId: invoice.activity_id,
      userId,
      isReversing: true,
      reversingOf: invoice.journal_entry_id,
      lines,
    }) : null;

    const originalEntryIds = new Set([invoice.journal_entry_id, ...payments.map((p) => p.journal_entry_id).filter(Boolean)]);
    for (const id of originalEntryIds) {
      db.prepare("UPDATE journal_entries SET status = 'reversed', updated_at = ? WHERE id = ?").run(cancelledAt, id);
    }

    let refundedCash = 0;
    let owedToCustomer = 0;
    for (const { payment, box, refund, owed } of refunds) {
      refundedCash += refund;
      owedToCustomer += owed;
      if (refund > 0) {
        insertCashTransaction(db, {
          docNumber: `${payment.doc_number}-R`,
          date,
          type: isSales ? 'payment' : 'receipt',
          direction: isSales ? 'out' : 'in',
          cashboxId: box.id,
          amount: refund,
          sourceType: 'invoice_cancel',
          sourceId: invoice.id,
          description: `إلغاء ${invoice.doc_number}`,
          journalEntryId: entry.id,
          userId,
        });
      }
      const partyDebit = isSales ? refund : 0;
      const partyCredit = isSales ? 0 : payment.amount;
      if (partyDebit > 0 || partyCredit > 0) {
        db.prepare(`
          INSERT INTO party_transactions (id, party_id, date, type, reference_type, reference_id, debit, credit, description)
          VALUES (?, ?, ?, 'payment', 'payment', ?, ?, ?, ?)
        `).run(crypto.randomUUID(), invoice.party_id, date, payment.id, partyDebit, partyCredit, `إلغاء ${invoice.doc_number}`);
      }
    }
    if (remainingTotal > 0) {
      db.prepare(`
        INSERT INTO party_transactions (id, party_id, date, type, reference_type, reference_id, debit, credit, description)
        VALUES (?, ?, ?, 'adjustment', 'invoice', ?, ?, ?, ?)
      `).run(crypto.randomUUID(), invoice.party_id, date, invoice.id,
        isSales ? 0 : remainingTotal, isSales ? remainingTotal : 0, `إلغاء ${invoice.doc_number}`);
    }

    db.prepare("UPDATE invoices SET status = 'cancelled', cancelled_at = ?, cancel_journal_entry_id = ?, updated_at = ? WHERE id = ?")
      .run(cancelledAt, entry?.id ?? null, cancelledAt, invoice.id);
    audit(db, {
      userId, action: 'cancel', module: 'sales', entityId: invoice.id, entityType: 'invoice',
      details: {
        docNumber: invoice.doc_number, reversedBy: entry?.entryNumber ?? null, returnedTotal: returned.total, refundedCash, owedToCustomer,
      },
    });
    return { id: invoice.id, reversalEntryNumber: entry?.entryNumber ?? null, refundedCash, owedToCustomer };
  })();
}

module.exports = { createInvoice, recordPayment, createReturn, listInvoices, cancelInvoice };
