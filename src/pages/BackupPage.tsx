import { useState, useEffect, useCallback, useRef } from 'react';
import { DatabaseBackup, Download, RotateCcw, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatShortDate } from '@/lib/format';
import { listBackupLogs, createBackup, restoreBackup, type BackupLog } from '@/services/backupService';

export default function BackupPage() {
  const { user, hasPermission } = useSession();
  const [logs, setLogs] = useState<BackupLog[]>([]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => listBackupLogs().then(setLogs), []);
  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    setCreating(true);
    setMessage(null);
    try {
      await createBackup(true, user?.id ?? null);
      setMessage({ type: 'success', text: 'تم إنشاء النسخة الاحتياطية وتنزيلها' });
      load();
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'خطأ' });
    } finally { setCreating(false); }
  }

  async function handleRestore(file: File) {
    if (!confirm('تحذير: الاستعادة قد تستبدل البيانات الحالية. هل أنت متأكد؟')) return;
    try {
      const result = await restoreBackup(file);
      setMessage({ type: result.success ? 'success' : 'error', text: result.message });
      load();
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'خطأ' });
    }
  }

  const lastBackup = logs.find((l) => l.status === 'success');

  return (
    <div>
      <PageHeader title="النسخ الاحتياطي والاستعادة" subtitle="نسخ محلية آمنة — الاحتفاظ بجميع النسخ دون حذف" icon={DatabaseBackup}
        actions={hasPermission('backup.create') ? (
          <>
            <button onClick={() => fileRef.current?.click()} className="btn-secondary"><RotateCcw className="h-4 w-4" /> استعادة</button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRestore(f); }} />
            <button onClick={handleCreate} disabled={creating} className="btn-primary">{creating ? 'جارٍ...' : <><Download className="h-4 w-4" /> إنشاء نسخة</>}</button>
          </>
        ) : undefined}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="card p-5">
          <div className="flex items-center justify-between"><span className="text-sm text-slate-500">آخر نسخة احتياطية</span>
            <Badge tone={lastBackup ? 'emerald' : 'slate'} dot>{lastBackup ? 'نجحت' : 'لم تُنشأ'}</Badge></div>
          <p className="mt-3 text-lg font-bold text-slate-700 num">{lastBackup ? formatShortDate(lastBackup.created_at) : '—'}</p>
        </div>
        <div className="card p-5"><p className="text-sm text-slate-500">عدد النسخ</p><p className="mt-3 text-2xl font-bold num text-slate-700">{logs.filter((l) => l.status === 'success').length}</p></div>
        <div className="card p-5"><p className="text-sm text-slate-500">النسخ المستعادة</p><p className="mt-3 text-2xl font-bold num text-slate-700">{logs.filter((l) => l.status === 'restored').length}</p></div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-3 mb-4 text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <div className="card">
        <div className="p-5 border-b border-slate-100 flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" /><h3 className="font-semibold text-slate-800">سجل النسخ الاحتياطية</h3>
        </div>
        {logs.length === 0 ? (
          <EmptyState icon={DatabaseBackup} title="لا توجد نسخ" description={'تُحفظ النسخ محليًا. اضغط «إنشاء نسخة» لبدء النسخ الاحتياطي.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">الملف</th><th className="px-4 py-3 text-right font-semibold">الحجم</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة</th><th className="px-4 py-3 text-right font-semibold">النوع</th>
                <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
              </tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-mono text-slate-600 text-xs">{l.filename}</td>
                    <td className="px-4 py-3 num text-slate-500">{l.file_size ? `${(l.file_size / 1024).toFixed(1)} KB` : '—'}</td>
                    <td className="px-4 py-3"><Badge tone={l.status === 'success' ? 'emerald' : l.status === 'restored' ? 'blue' : 'rose'} dot>{l.status === 'success' ? 'نجحت' : l.status === 'restored' ? 'مستعادة' : 'فشلت'}</Badge></td>
                    <td className="px-4 py-3">{l.is_manual ? <Badge tone="slate">يدوي</Badge> : <Badge tone="slate">تلقائي</Badge>}</td>
                    <td className="px-4 py-3 num text-slate-600">{formatShortDate(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
