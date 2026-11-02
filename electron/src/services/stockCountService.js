const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { assertIsoDate, optionalText, toMilli, mulDivRound } = require('../domain/money');
const { nextDocNumber, postJournalEntry } = require('../domain/postingEngine');
const { receiveStock, issueStock } = require('./inventoryService');

// الجرد يقارن الكمية الفعلية بالدفترية، ويُرحَّل الفرق كاملًا بقيد واحد على حساب فروق الجرد (521)
function recordStockCount(db, userId, input) {
  const date = assertIsoDate(input?.date);
  const notes = optionalText(input?.notes, 300);
  if (!Array.isArray(input?.items) || input.items.length === 0) throw new UserFacingError('أدخل صنفًا واحدًا على الأقل للجرد');

  const counted = input.items.map((raw) => {
    const product = db.prepare('SELECT id, name, quantity_milli, total_value FROM products WHERE id = ? AND is_active = 1')
      .get(String(raw?.productId ?? ''));
    if (!product) throw new UserFacingError('الصنف غير موجود');
    const countedQty = toMilli(raw?.countedQuantity, 'الكمية الفعلية', { allowZero: true });
    return { product, countedQty, difference: countedQty - product.quantity_milli };
  });

  return db.transaction(() => {
    const countId = crypto.randomUUID();
    const docNumber = nextDocNumber(db, 'stock_adjustment');
    let gains = 0;
    let losses = 0;
    const applied = counted.map((line) => {
      if (line.difference === 0) return { ...line, unitCost: 0, value: 0 };
      if (line.difference > 0) {
        const cost = line.product.quantity_milli === 0 ? 0
          : mulDivRound(line.difference, line.product.total_value, line.product.quantity_milli);
        const received = receiveStock(db, {
          date, productId: line.product.id, quantityMilli: line.difference, totalCost: cost,
          type: 'count', referenceType: 'stock_count', referenceId: countId, notes, userId,
        });
        gains += received.totalCost;
        return { ...line, unitCost: received.unitCost, value: received.totalCost };
      }
      const issued = issueStock(db, {
        date, productId: line.product.id, quantityMilli: -line.difference, type: 'count',
        referenceType: 'stock_count', referenceId: countId, notes, userId,
      });
      losses += issued.totalCost;
      return { ...line, unitCost: issued.unitCost, value: issued.totalCost };
    });

    if (gains > 0 || losses > 0) {
      const lines = [];
      if (gains > 0) lines.push({ accountId: 'acc_inventory', debit: gains }, { accountId: 'acc_inventory_adj', credit: gains });
      if (losses > 0) lines.push({ accountId: 'acc_inventory_adj', debit: losses }, { accountId: 'acc_inventory', credit: losses });
      postJournalEntry(db, { date, description: docNumber, referenceType: 'stock_count', referenceId: countId, lines, userId });
    }

    db.prepare(`
      INSERT INTO stock_counts (id, doc_number, date, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(countId, docNumber, date, gains + losses > 0 ? 'adjusted' : 'completed', notes, userId);
    const insertItem = db.prepare(`
      INSERT INTO stock_count_items (id, count_id, product_id, system_qty_milli, counted_qty_milli, difference_milli, unit_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of applied) {
      insertItem.run(crypto.randomUUID(), countId, line.product.id, line.product.quantity_milli,
        line.countedQty, line.difference, line.unitCost);
    }
    audit(db, { userId, action: 'create', module: 'inventory', entityId: countId, entityType: 'stock_count', details: { docNumber, gains, losses } });
    return { id: countId, docNumber, gains, losses };
  })();
}

function listStockCounts(db) {
  return db.prepare('SELECT id, doc_number, date, status, notes FROM stock_counts ORDER BY date DESC, doc_number DESC LIMIT 100').all();
}

module.exports = { recordStockCount, listStockCounts };
