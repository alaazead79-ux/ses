import { useState, useEffect, useCallback } from 'react';
import { FileCheck, Plus, X, AlertCircle, CalendarClock } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP, formatShortDate } from '@/lib/format';
import { listChecks, createCheck, updateCheckStatus, type Check } from '@/services/financeService';
import { listParties, type Party } from '@/services/partyService';
import { listActivities, type Activity } from '@/services/activityService';

const STATUS_LABELS: Record<string, string> = {
  received: 'مستلم', issued: 'صادر', due: 'مستحق', collected: 'تم التحصيل', paid: 'تم الصرف', returned: 'مرتد', cancelled: 'ملغى',
};
const STATUS_TONES: Record<string, 'emerald' | 'amber' | 'rose' | 'blue' | 'slate' | 'violet'> = {
  received: 'blue', issued: 'amber', due: 'amber', collected: 'emerald', paid: 'emerald', returned: 'rose', cancelled: 'slate',
};

export default function ChecksPage() {
  const { hasPermission } = useSession();
  const [checks, setChecks] = useState<Check[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => listChecks().then(setChecks), []);
  useEffect(() => { load(); }, [load]);

  const stats = {
    dueSoon: checks.filter((c) => {
      const days = Math.ceil((new Date(c.due_date).getTime() - Date.now()) / 86400000);
      return days >= 0 && days <= 7 && c.status !== 'collected' && c.status !== 'paid' && c.status !== 'cancelled';
    }),
    collected: checks.filter((c) => c.status === 'collected'),
    returned: checks.filter((c) => c.status === 'returned'),
    cancelled: checks.filter((c) => c.status === 'cancelled'),
  };

  return (
    <div>
      <PageHeader title="الشيكات" subtitle="الشيكات الواردة والصادرة وتتبّع حالاتها ومواعيد استحقاقها" icon={FileCheck}
        actions={hasPermission('checks.add') ? <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> شيك جديد</button> : undefined}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatBox label="مستحقة قريبًا" value={stats.dueSoon.length} tone="amber" />
        <StatBox label="تم التحصيل" value={stats.collected.length} tone="emerald" />
        <StatBox label="مرتد" value={stats.returned.length} tone="rose" />
        <StatBox label="ملغى" value={stats.cancelled.length} tone="slate" />
      </div>
      <div className="card overflow-hidden">
        {checks.length === 0 ? (
          <EmptyState icon={FileCheck} title="لا توجد شيكات" description="تظهر هنا الشيكات الواردة والصادرة مع تنبيهات الاستحقاق." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">الرقم</th>
                <th className="px-4 py-3 text-right font-semibold">الشيك</th>
                <th className="px-4 py-3 text-right font-semibold">الاتجاه</th>
                <th className="px-4 py-3 text-right font-semibold">الطرف</th>
                <th className="px-4 py-3 text-right font-semibold">المبلغ</th>
                <th className="px-4 py-3 text-right font-semibold">الاستحقاق</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                <th className="px-4 py-3 text-right font-semibold">تغيير</th>
              </tr></thead>
              <tbody>
                {checks.map((c) => {
                  const days = Math.ceil((new Date(c.due_date).getTime() - Date.now()) / 86400000);
                  const dueSoon = days >= 0 && days <= 7 && c.status !== 'collected' && c.status !== 'paid' && c.status !== 'cancelled';
                  return (
                    <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono text-slate-500 num">{c.doc_number}</td>
                      <td className="px-4 py-3 text-slate-600 num">{c.check_number ?? '—'}</td>
                      <td className="px-4 py-3"><Badge tone={c.direction === 'incoming' ? 'blue' : 'amber'}>{c.direction === 'incoming' ? 'وارد' : 'صادر'}</Badge></td>
                      <td className="px-4 py-3 text-slate-700">{c.party_name ?? '—'}</td>
                      <td className="px-4 py-3 num font-semibold">{formatEGP(c.amount / 100)}</td>
                      <td className="px-4 py-3">
                        <span className="num text-slate-600">{formatShortDate(c.due_date)}</span>
                        {dueSoon && <span className="mr-2 inline-flex items-center gap-0.5 text-xs text-amber-600"><CalendarClock className="h-3 w-3" />{days} يوم</span>}
                      </td>
                      <td className="px-4 py-3"><Badge tone={STATUS_TONES[c.status]} dot>{STATUS_LABELS[c.status]}</Badge></td>
                      <td className="px-4 py-3">
                        <select
                          value={c.status}
                          onChange={async (e) => { await updateCheckStatus(c.id, e.target.value); load(); }}
                          className="text-xs rounded border border-slate-200 px-1.5 py-1 bg-white"
                        >
                          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showModal && <CheckModal onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: string }) {
  const colors: Record<string, string> = { amber: 'text-amber-600', emerald: 'text-emerald-600', rose: 'text-rose-600', slate: 'text-slate-600' };
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold num ${colors[tone]}`}>{value}</p>
    </div>
  );
}

function CheckModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [parties, setParties] = useState<Party[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [partyId, setPartyId] = useState('');
  const [bankName, setBankName] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [activityId, setActivityId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { listParties().then(setParties); listActivities().then(setActivities); }, []);

  async function handleSave() {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    setSaving(true);
    try {
      await createCheck({ date, direction, amount: amt, partyId: partyId || null, bankName, checkNumber, dueDate, activityId: activityId || null, createdBy: user?.id ?? null });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">شيك جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاتجاه</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'incoming' | 'outgoing')} className="input-base">
              <option value="incoming">وارد</option><option value="outgoing">صادر</option>
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">تاريخ الإصدار</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">تاريخ الاستحقاق</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-base" /></div>
          </div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">المبلغ (ج.م)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الطرف</label>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="input-base">
              <option value="">—</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">رقم الشيك</label><input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} className="input-base num" /></div>
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">البنك</label><input value={bankName} onChange={(e) => setBankName(e.target.value)} className="input-base" /></div>
          </div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النشاط</label>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base">
              <option value="">— عام —</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
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
