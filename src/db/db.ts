import { PGlite } from '@electric-sql/pglite';
import { getDesktopApi } from '@/lib/electronBridge';

/**
 * Database manager — طبقة قاعدة البيانات
 *
 * في بيئة المتصفح (Bolt/Vite): تستخدم PGlite (Postgres WASM) محفوظة في IndexedDB.
 * في بيئة Electron الإنتاجية: تُستبدل بـ better-sqlite3 عبر IPC (نفس الـ SQL تقريبًا).
 *
 * كل المبالغ المالية تُخزَّن كأعداد صحيحة (قرش صعيد = 1) لتجنب أخطاء الفواصل العشرية.
 * عند العرض، نقسم على 100 لتحويلها إلى جنيه.
 */

let dbInstance: PGlite | null = null;
let initPromise: Promise<PGlite> | null = null;

// قرش صعيد في الجنيه — لتخزين المبالغ كأعداد صحيحة
export const CENTS_PER_EGP = 100;

/** تحويل جنيه إلى قرش (تخزين) */
export function toCents(egp: number): number {
  return Math.round(egp * CENTS_PER_EGP);
}

/** تحويل قرش إلى جنيه (عرض) */
export function toEgp(cents: number): number {
  return cents / CENTS_PER_EGP;
}

async function loadMigrations(): Promise<{ id: string; sql: string }[]> {
  // استيراد ملفات SQL خام عبر Vite ?raw
  const modules = import.meta.glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, sql]) => ({ id: path.split('/').pop()!.replace('.sql', ''), sql }));
}

export async function getDb(): Promise<PGlite> {
  if (getDesktopApi()) throw new Error('قاعدة المتصفح غير متاحة في تطبيق سطح المكتب');
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = new PGlite('idb://farm-accounting');

    // تفعيل الإعدادات الأساسية
    await db.exec('SET timezone = \'Africa/Cairo\';');

    // تطبيق التهييرات بالترتيب
    const migrations = await loadMigrations();
    for (const migration of migrations) {
      await db.exec(migration.sql);
    }

    dbInstance = db;
    return db;
  })();

  return initPromise;
}

/** إعادة ضبط قاعدة البيانات — تستخدم في الاختبارات فقط */
export async function resetDatabase(): Promise<void> {
  if (!dbInstance) return;
  await dbInstance.close();
  dbInstance = null;
  initPromise = null;
  // حذف قاعدة IndexedDB
  if (typeof indexedDB !== 'undefined') {
    indexedDB.deleteDatabase('/farm-accounting');
  }
  await getDb();
}

export type { PGlite };
