import { getDb } from '@/db/db';

export interface Setting {
  key: string;
  value: string;
  label: string;
  category: string;
}

export async function getSettings(): Promise<Map<string, string>> {
  const db = await getDb();
  const res = await db.query<{ key: string; value: string }>('SELECT key, value FROM app_settings');
  return new Map(res.rows.map((r) => [r.key, r.value]));
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const res = await db.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key]);
  return res.rows[0]?.value ?? null;
}

export async function updateSetting(key: string, value: string, updatedBy: string | null): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE app_settings SET value = $1, updated_at = now(), updated_by = $2 WHERE key = $3`,
    [value, updatedBy, key]
  );
}

export async function updateSettings(items: { key: string; value: string }[], updatedBy: string | null): Promise<void> {
  const db = await getDb();
  for (const item of items) {
    await db.query(
      `UPDATE app_settings SET value = $1, updated_at = now(), updated_by = $2 WHERE key = $3`,
      [item.value, updatedBy, item.key]
    );
  }
}
