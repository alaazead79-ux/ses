import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { formatEGP } from '@/lib/format';
import { listCashboxOptions, type CashboxOption } from '@/services/invoiceService';
import { listCustomerCredits, refundCustomerCredit, type CustomerCredit } from '@/services/customerCreditService';

export default function CustomerRefundModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [customers, setCustomers] = useState<CustomerCredit[]>([]);
  const [cashboxes, setCashboxes] = useState<CashboxOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listCustomerCredits(), listCashboxOptions()])
      .then(([credits, boxes]) => { setCustomers(credits); setCashboxes(boxes); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات'))
      .finally(() => setLoading(false));
  }, []);

  const customer = customers.find((c) => c.id === partyId) ?? null;
  const box = cashboxes.find((b) => b.id === cashboxId) ?? null;
  const creditPounds = customer ? customer.credit / 100 : 0;
  const boxPounds = box ? box.balance / 100 : 0;

  async function handleSave() {
    setError(null);
    const value = parseFloat(amount);
    if (!customer) { setError('اختر العميل'); return; }
    if (!box) { setError('اختر الخزينة'); return; }
    if (!value || value <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    if (value > creditPounds) { setError(`المبلغ أكبر من الرصيد الدائن للعميل (${formatEGP(creditPounds)})`); return; }
    if (value > boxPounds) { setError(`المبلغ أكبر من رصيد الخزينة (${formatEGP(boxPounds)})`); return; }
    setSaving(true);
    try {
      await refundCustomerCredit({
        partyId: customer.id, cashboxId: box.id, date: new Date().toISOString().slice(0, 10), amount: value,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">رد الرصيد الدائن للعميل</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        {!loading && customers.length === 0 ? (
          <p className="text-sm text-slate-600 mb-4">لا يوجد عملاء لديهم رصيد دائن.</p>
        ) : (
          <div className="space-y-4 mb-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">العميل</label>
              <select value={partyId} onChange={(e) => { setPartyId(e.target.value); setAmount(''); }} className="input-base" disabled={loading}>
                <option value="">اختر العميل</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {customer && <p className="text-xs text-slate-500 mt-1">الرصيد الدائن: <span className="num font-semibold text-slate-700">{formatEGP(creditPounds)}</span></p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">الخزينة</label>
              <select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} className="input-base" disabled={loading}>
                <option value="">اختر الخزينة</option>
                {cashboxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {box && <p className="text-xs text-slate-500 mt-1">رصيد الخزينة: <span className="num font-semibold text-slate-700">{formatEGP(boxPounds)}</span></p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">المبلغ المردود</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base num" />
            </div>
          </div>
        )}
        {error && <div className="flex items-center gap-2 text-sm text-rose-600 mb-3"><AlertCircle className="h-4 w-4" />{error}</div>}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving || !customer || !box} className="btn-primary flex-1">
            {saving ? 'جارٍ الحفظ...' : 'تأكيد الرد'}
          </button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
