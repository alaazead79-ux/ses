import { useState, useEffect, useCallback } from 'react';
import { Wallet, X, AlertCircle, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP, formatShortDate } from '@/lib/format';
import { listCashboxes, listCashTransactions, createCashTransaction, type Cashbox, type CashTransaction } from '@/services/treasuryService';
import { listActivities, type Activity } from '@/services/activityService';

const TYPE_LABELS: Record<string, string> = {
  receipt: 'سند قبض', payment: 'سند صرف', deposit: 'إيداع', withdrawal: 'سحب', opening: 'رصيد افتتاحي',
};

export default function TreasuryPage() {
  const { hasPermission } = useSession();
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [type, setType] = useState<'receipt' | 'payment'>('receipt');

  const load = useCallback(async () => {
    const [cb, tx] = await Promise.all([listCashboxes(), listCashTransactions(100)]);
    setCashboxes(cb); setTransactions(tx);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="الخزينة" subtitle="سندات القبض والصرف وكشف حركة الخزينة" icon={Wallet}
        actions={hasPermission('treasury.add') ? (
          <>
            <button onClick={() => { setType('receipt'); setShowModal(true); }} className="btn-secondary"><ArrowDownCircle className="h-4 w-4" /> سند قبض</button>
            <button onClick={() => { setType('payment'); setShowModal(true); }} className="btn-primary"><ArrowUpCircle className="h-4 w-4" /> سند صرف</button>
          </>
        ) : undefined}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {cashboxes.map((cb) => (
          <div key={cb.id} className="card p-5">
            <p className="text-sm text-slate-500">{cb.name}</p>
            <p className="mt-2 text-2xl font-bold text-slate-800 num">{formatEGP(cb.balance / 100)}</p>
            <p className="text-xs text-slate-400 mt-1">الرصيد الحالي</p>
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">كشف حركة الخزينة</h3>
        </div>
        {transactions.length === 0 ? (
          <EmptyState icon={Wallet} title="لا توجد حركات" description="ستظهر سندات القبض والصرف هنا." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">الرقم</th>
                <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                <th className="px-4 py-3 text-right font-semibold">النوع</th>
                <th className="px-4 py-3 text-right font-semibold">الطرف</th>
                <th className="px-4 py-3 text-right font-semibold">البيان</th>
                <th className="px-4 py-3 text-right font-semibold">المبلغ</th>
              </tr></thead>
              <tbody>
                {transactions.map((t) => {
                  const isReceipt = t.type === 'receipt' || t.type === 'deposit' || t.type === 'opening';
                  return (
                    <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono text-slate-500 num">{t.doc_number}</td>
                      <td className="px-4 py-3 text-slate-600 num">{formatShortDate(t.date)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={isReceipt ? 'emerald' : 'rose'}>{TYPE_LABELS[t.type] ?? t.type}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{t.party_name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{t.description ?? '—'}</td>
                      <td className={`px-4 py-3 num font-semibold ${isReceipt ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isReceipt ? '+' : '−'}{formatEGP(t.amount / 100)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showModal && <CashModal type={type} onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

function CashModal({ type, onClose, onSaved }: { type: 'receipt' | 'payment'; onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [cashboxId, setCashboxId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [activityId, setActivityId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listCashboxes().then((cb) => { setCashboxes(cb); if (cb[0]) setCashboxId(cb[0].id); });
    listActivities().then(setActivities);
  }, []);

  async function handleSave() {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    if (!cashboxId) { setError('اختر الخزينة'); return; }
    setSaving(true);
    try {
      await createCashTransaction({
        date, type, cashboxId, amount: amt, description, activityId: activityId || null, createdBy: user?.id ?? null,
      });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  }

  const isReceipt = type === 'receipt';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">{isReceipt ? 'سند قبض' : 'سند صرف'}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الخزينة</label>
            <select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} className="input-base">
              {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">المبلغ (ج.م)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النشاط</label>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base">
              <option value="">— عام —</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">البيان</label><input value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" /></div>
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
