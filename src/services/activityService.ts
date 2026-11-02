import { getDb } from '@/db/db';
import { getDesktopApi } from '@/lib/electronBridge';

export interface Activity {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

export async function listActivities(): Promise<Activity[]> {
  const desktop = getDesktopApi();
  if (desktop) {
    const rows = await desktop.farm.activities.list();
    return rows.map((row) => ({ ...row, is_active: row.is_active === 1 }));
  }
  const db = await getDb();
  const res = await db.query<Activity>(
    'SELECT id, name, description, is_active, sort_order FROM activities ORDER BY sort_order, name'
  );
  return res.rows;
}

export async function createActivity(data: { name: string; description?: string; sortOrder?: number }): Promise<Activity> {
  const db = await getDb();
  const res = await db.query<Activity>(
    `INSERT INTO activities (name, description, sort_order) VALUES ($1, $2, $3)
     RETURNING id, name, description, is_active, sort_order`,
    [data.name, data.description ?? null, data.sortOrder ?? 0]
  );
  return res.rows[0];
}

export async function updateActivity(id: string, data: { name?: string; description?: string; is_active?: boolean; sort_order?: number }): Promise<void> {
  const db = await getDb();
  const existing = (await db.query<Activity>('SELECT * FROM activities WHERE id = $1', [id])).rows[0];
  if (!existing) throw new Error('النشاط غير موجود');
  await db.query(
    `UPDATE activities SET name = $1, description = $2, is_active = $3, sort_order = $4, updated_at = now() WHERE id = $5`,
    [data.name ?? existing.name, data.description ?? existing.description, data.is_active ?? existing.is_active, data.sort_order ?? existing.sort_order, id]
  );
}

export async function deleteActivity(id: string): Promise<void> {
  const db = await getDb();
  // لا نحذف الأنشطة الافتراضية
  if (['fattening', 'dairy', 'breeding', 'other'].includes(id)) {
    throw new Error('لا يمكن حذف الأنشطة الافتراضية');
  }
  await db.query('DELETE FROM activities WHERE id = $1', [id]);
}
