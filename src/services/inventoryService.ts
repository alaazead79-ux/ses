import { getDb, toCents } from '@/db/db';
import { createJournalEntry } from './accountingService';

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  reorder_level: number;
  avg_cost: number;
  quantity: number;
  is_active: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  feed: 'أعلاف', supplies: 'مستلزمات', medication: 'أدوية', spare_parts: 'قطع غيار', other: 'أخرى',
};

export async function listProducts(): Promise<Product[]> {
  const db = await getDb();
  const res = await db.query<Product>(
    'SELECT id, name, sku, category, unit, reorder_level, avg_cost, quantity, is_active FROM products ORDER BY name'
  );
  return res.rows;
}

export async function createProduct(data: {
  name: string;
  category: string;
  unit: string;
  reorderLevel?: number;
  sku?: string;
}): Promise<Product> {
  const db = await getDb();
  const res = await db.query<Product>(
    `INSERT INTO products (name, sku, category, unit, reorder_level) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, sku, category, unit, reorder_level, avg_cost, quantity, is_active`,
    [data.name, data.sku ?? null, data.category, data.unit, data.reorderLevel ?? 0]
  );
  return res.rows[0];
}

export async function updateProduct(id: string, data: Partial<{ name: string; category: string; unit: string; reorder_level: number; is_active: boolean; }>): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { values.push(data.name); fields.push(`name = $${values.length}`); }
  if (data.category !== undefined) { values.push(data.category); fields.push(`category = $${values.length}`); }
  if (data.unit !== undefined) { values.push(data.unit); fields.push(`unit = $${values.length}`); }
  if (data.reorder_level !== undefined) { values.push(data.reorder_level); fields.push(`reorder_level = $${values.length}`); }
  if (data.is_active !== undefined) { values.push(data.is_active); fields.push(`is_active = $${values.length}`); }
  if (fields.length === 0) return;
  values.push(id);
  await db.query(`UPDATE products SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
}

export async function deleteProduct(id: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM products WHERE id = $1', [id]);
}

export interface StockMovement {
  id: string;
  date: string;
  product_id: string;
  product_name: string;
  type: string;
  direction: string;
  quantity: number;
  unit_cost: number;
  reference_type: string | null;
}

/** تسجيل حركة مخزون مع تحديث المتوسط المرجح */
export async function recordStockMovement(data: {
  date: string;
  productId: string;
  type: 'purchase' | 'sale' | 'issue' | 'adjustment' | 'count';
  direction: 'in' | 'out';
  quantity: number;
  unitCost: number;
  activityId?: string | null;
  referenceType?: string;
  referenceId?: string;
  createdBy?: string | null;
}): Promise<void> {
  if (data.quantity <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر');
  const db = await getDb();

  // جلب الصنف الحالي
  const prodRes = await db.query<{ name: string; quantity: number; avg_cost: number }>(
    'SELECT name, quantity, avg_cost FROM products WHERE id = $1', [data.productId]
  );
  if (prodRes.rows.length === 0) throw new Error('الصنف غير موجود');
  const prod = prodRes.rows[0];

  let newQty = prod.quantity;
  let newAvgCost = prod.avg_cost;

  if (data.direction === 'in') {
    // المتوسط المرجح = (الكمية الحالية × التكلفة الحالية + الكمية الواردة × التكلفة الجديدة) / الإجمالي
    const totalCost = prod.quantity * prod.avg_cost + data.quantity * toCents(data.unitCost);
    newQty = prod.quantity + data.quantity;
    newAvgCost = newQty > 0 ? totalCost / newQty : prod.avg_cost;
  } else {
    newQty = prod.quantity - data.quantity;
    if (newQty < 0) throw new Error(`الكمية غير كافية. المتوفر: ${prod.quantity} ${prod.name ? '' : ''}`);
  }

  // حفظ الحركة
  await db.query(
    `INSERT INTO stock_movements (date, product_id, type, direction, quantity, unit_cost, balance_after, reference_type, reference_id, activity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [data.date, data.productId, data.type, data.direction, data.quantity, toCents(data.unitCost), newQty,
     data.referenceType ?? null, data.referenceId ?? null, data.activityId ?? null]
  );

  // تحديث الصنف
  await db.query('UPDATE products SET quantity = $1, avg_cost = $2, updated_at = now() WHERE id = $3',
    [newQty, newAvgCost, data.productId]);

  // قيد محاسبي للمخزون (شراء وارد)
  if (data.type === 'purchase' && data.direction === 'in') {
    await createJournalEntry({
      date: data.date,
      description: `شراء مخزون: ${prod.name}`,
      referenceType: 'stock',
      activityId: data.activityId,
      lines: [
        { accountId: 'acc_inventory', debit: data.quantity * data.unitCost, credit: 0 },
        { accountId: 'acc_cash', debit: 0, credit: data.quantity * data.unitCost },
      ],
      createdBy: data.createdBy,
    });
  }
}

export async function listStockMovements(productId?: string): Promise<StockMovement[]> {
  const db = await getDb();
  let query = `
    SELECT s.id, s.date::text, s.product_id, p.name as product_name, s.type, s.direction,
           s.quantity, s.unit_cost, s.reference_type
    FROM stock_movements s JOIN products p ON s.product_id = p.id`;
  const params: unknown[] = [];
  if (productId) { params.push(productId); query += ` WHERE s.product_id = $1`; }
  query += ' ORDER BY s.date DESC, s.id DESC';
  const res = await db.query<StockMovement>(query, params);
  return res.rows;
}

export function getCategoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat;
}
