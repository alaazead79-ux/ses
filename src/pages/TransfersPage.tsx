import { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, Plus, X, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP, formatShortDate } from '@/lib/format';
import { listTransfers, createTransfer, type FinancialTransfer } from '@/services/financeService';
import { listParties, type Party } from '@/services/partyService';
import { listActivities, type Activity } from '@/services/activityService';

export default function TransfersPage() {
  const { hasPermission } = useSession();
  const [transfers, setTransfers] = useState<FinancialTransfer[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => listTransfers().then(setTransfers), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="التحويلات والحركات البنكية" subtitle="سجل التحويلات الواردة والصادرة" icon={ArrowLeftRight}
        actions={hasPermission('transfers.add') ? <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> تحويل جديد</button> : undefined}
      />
      <div className="card overflow-hidden">
        {transfers.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="لا توجد تحويلات" description="تُسجَّل هنا التحويلات الواردة والصادرة." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">الرقم</th>
                <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                <th className="px-4 py-3 text-right font-semibold">الاتجاه</th>
                <th className="px-4 py-3 text-right font-semibold">الطرف</th>
                <th className="px-4 py-3 text-right font-semibold">المرجع</th>
                <th className="px-4 py-3 text-right font-semibold">المبلغ</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة</th>
              </tr></thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono text-slate-500 num">{t.doc_number}</td>
                    <td className="px-4 py-3 text-slate-600 num">{formatShortDate(t.date)}</td>
                    <td className="px-4 py-3"><Badge tone={t.direction === 'inbound' ? 'emerald' : 'amber'}>{t.direction === 'inbound' ? 'وارد' : 'صادر'}</Badge></td>
                    <td className="px-4 py-3 text-slate-700">{t.party_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 num">{t.ref_number ?? '—'}</td>
                    <td className="px-4 py-3 num font-semibold">{formatEGP(t.amount / 100)}</td>
                    <td className="px-4 py-3"><Badge tone={t.status === 'completed' ? 'emerald' : 'slate'} dot>{t.status === 'completed' ? 'مكتمل' : 'معلق'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showModal && <TransferModal onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

function TransferModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [parties, setParties] = useState<Party[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [partyId, setPartyId] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [activityId, setActivityId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { listParties().then(setParties); listActivities().then(setActivities); }, []);

  async function handleSave() {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    setSaving(true);
    try {
      await createTransfer({ date, direction, amount: amt, partyId: partyId || null, refNumber, activityId: activityId || null, description, createdBy: user?.id ?? null });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">تحويل جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاتجاه</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'inbound' | 'outbound')} className="input-base">
              <option value="inbound">وارد</option><option value="outbound">صادر</option>
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">المبلغ (ج.م)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الطرف</label>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="input-base">
              <option value="">—</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">رقم المرجع</label><input value={refNumber} onChange={(e) => setRefNumber(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النشاط</label>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base">
              <option value="">— عام —</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الوصف</label><input value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" /></div>
          {error && <div className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle className="h-4 w-4" />{error}</div>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
