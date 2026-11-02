const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { requireText, optionalText, toMilli, toPiastres, mulDivRound } = require('../domain/money');

const PRODUCT_CATEGORIES = ['feed', 'supplies', 'medication', 'spare_parts', 'other'];
const DEFAULT_WAREHOUSE = 'wh_main';

function readProduct(db, productId) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new UserFacingError('الصنف غير موجود');
  return product;
}

function averageUnitCost(product) {
  if (product.quantity_milli === 0) return 0;
  return mulDivRound(product.total_value, 1000, product.quantity_milli);
}

function listProducts(db) {
  return db.prepare(`
    SELECT id, name, sku, category, unit, reorder_level_milli, quantity_milli, total_value, is_active,
      CASE WHEN quantity_milli = 0 THEN 0 ELSE CAST(ROUND(total_value * 1000.0 / quantity_milli) AS INTEGER) END AS unit_cost,
      CASE WHEN quantity_milli <= reorder_level_milli AND reorder_level_milli > 0 THEN 1 ELSE 0 END AS is_low_stock
    FROM products WHERE is_active = 1 ORDER BY name
  `).all().map((row) => ({ ...row, is_active: row.is_active === 1, is_low_stock: row.is_low_stock === 1 }));
}

function createProduct(db, userId, input) {
  const name = requireText(input?.name, 'اسم الصنف', 120);
  const category = input?.category ?? 'supplies';
  if (!PRODUCT_CATEGORIES.includes(category)) throw new UserFacingError('تصنيف الصنف غير صالح');
  const unit = requireText(input?.unit ?? 'وحدة', 'الوحدة', 30);
  const reorderLevelMilli = toMilli(input?.reorderLevel ?? 0, 'حد إعادة الطلب', { allowZero: true });
  const sku = optionalText(input?.sku, 40);
  if (sku && db.prepare('SELECT id FROM products WHERE sku = ?').get(sku)) {
    throw new UserFacingError('رمز الصنف مستخدم بالفعل');
  }
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO products (id, name, sku, category, unit, reorder_level_milli, account_id)
    VALUES (?, ?, ?, ?, ?, ?, 'acc_inventory')
  `).run(id, name, sku, category, unit, reorderLevelMilli);
  audit(db, { userId, action: 'create', module: 'inventory', entityId: id, entityType: 'product', details: { name } });
  return { id };
}

// يجب استدعاؤها داخل معاملة يملكها المستدعي
function receiveStock(db, {
  date, productId, quantityMilli, totalCost, type = 'purchase', referenceType = null, referenceId = null,
  activityId = null, journalEntryId = null, userId = null, notes = null,
}) {
  const product = readProduct(db, productId);
  const qty = assertPositiveMilli(quantityMilli);
  const cost = toPiastres(totalCost, 'التكلفة', { allowZero: true });
  const quantityAfter = product.quantity_milli + qty;
  const valueAfter = product.total_value + cost;
  const unitCost = mulDivRound(cost, 1000, qty);
  db.prepare('UPDATE products SET quantity_milli = ?, total_value = ?, updated_at = ? WHERE id = ?')
    .run(quantityAfter, valueAfter, new Date().toISOString(), productId);
  insertMovement(db, {
    date, productId, type, direction: 'in', quantityMilli: qty, unitCost, totalCost: cost,
    quantityAfter, valueAfter, referenceType, referenceId, activityId, journalEntryId, userId, notes,
  });
  return { unitCost, totalCost: cost };
}

// يُرجع تكلفة البضاعة المصروفة بالمتوسط المرجح الحالي؛ آخر وحدة تُخرج تفرغ القيمة بالكامل
function issueStock(db, {
  date, productId, quantityMilli, type = 'sale', referenceType = null, referenceId = null,
  activityId = null, journalEntryId = null, userId = null, notes = null,
}) {
  const product = readProduct(db, productId);
  const qty = assertPositiveMilli(quantityMilli);
  if (qty > product.quantity_milli) {
    throw new UserFacingError(`الكمية المتاحة من ${product.name} غير كافية`);
  }
  const cost = qty === product.quantity_milli
    ? product.total_value
    : mulDivRound(qty, product.total_value, product.quantity_milli);
  const quantityAfter = product.quantity_milli - qty;
  const valueAfter = product.total_value - cost;
  const unitCost = mulDivRound(cost, 1000, qty);
  db.prepare('UPDATE products SET quantity_milli = ?, total_value = ?, updated_at = ? WHERE id = ?')
    .run(quantityAfter, valueAfter, new Date().toISOString(), productId);
  insertMovement(db, {
    date, productId, type, direction: 'out', quantityMilli: qty, unitCost, totalCost: cost,
    quantityAfter, valueAfter, referenceType, referenceId, activityId, journalEntryId, userId, notes,
  });
  return { unitCost, totalCost: cost };
}

function insertMovement(db, m) {
  db.prepare(`
    INSERT INTO stock_movements (
      id, date, product_id, warehouse_id, type, direction, quantity_milli, unit_cost, total_cost,
      quantity_after_milli, value_after, reference_type, reference_id, activity_id, journal_entry_id, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), m.date, m.productId, DEFAULT_WAREHOUSE, m.type, m.direction, m.quantityMilli,
    m.unitCost, m.totalCost, m.quantityAfter, m.valueAfter, m.referenceType, m.referenceId,
    m.activityId, m.journalEntryId, m.notes, m.userId,
  );
}

function assertPositiveMilli(value, label = 'الكمية') {
  if (!Number.isSafeInteger(value) || value <= 0) throw new UserFacingError(`${label} غير صالحة`);
  return value;
}

function listStockMovements(db, productId) {
  return db.prepare(`
    SELECT id, date, type, direction, quantity_milli, unit_cost, total_cost, quantity_after_milli, value_after, notes, created_at
    FROM stock_movements WHERE product_id = ? ORDER BY date, created_at, rowid
  `).all(readProduct(db, productId).id);
}

module.exports = {
  PRODUCT_CATEGORIES,
  averageUnitCost,
  listProducts,
  createProduct,
  receiveStock,
  issueStock,
  listStockMovements,
};
