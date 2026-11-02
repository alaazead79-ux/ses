import { useState, useEffect, useCallback } from 'react';
import { Receipt, Plus, X, AlertCircle, Trash2, Eye } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP, formatShortDate } from '@/lib/format';
import { listInvoices, createInvoice, recordPayment, type Invoice } from '@/services/invoiceService';
import { listParties, type Party } from '@/services/partyService';
import { listActivities, type Activity } from '@/services/activityService';

const DOC_TYPE_LABELS: Record<string, string> = {
  sales: 'مبيعات', purchase: 'مشتريات', sales_return: 'مرتجع مبيعات', purchase_return: 'مرتجع مشتريات',
};
const DOC_TYPE_TONES: Record<string, 'emerald' | 'amber' | 'rose' | 'blue'> = {
  sales: 'emerald', purchase: 'amber', sales_return: 'rose', purchase_return: 'blue',
};

export default function SalesPage() {
  const { hasPermission } = useSession();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);

  const load = useCallback(() => listInvoices().then(setInvoices), []);
  useEffect(() => { load(); }, [load]);

  const canAdd = hasPermission('sales.add');

  return (
    <div>
      <PageHeader title="المبيعات والمشتريات" subtitle="فواتير المبيعات والمشتريات والمرتجعات والمدفوعات" icon={Receipt}
        actions={canAdd ? <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> فاتورة جديدة</button> : undefined}
      />
      <div className="card overflow-hidden">
        {invoices.length === 0 ? (
          <EmptyState icon={Receipt} title="لا توجد فواتير" description="تنشأ هنا فواتير المبيعات والمشتريات والمرتجعات، مع بنود الأصناف أو مبلغ إجمالي." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">رقم</th>
                <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                <th className="px-4 py-3 text-right font-semibold">النوع</th>
                <th className="px-4 py-3 text-right font-semibold">الطرف</th>
                <th className="px-4 py-3 text-right font-semibold">الإجمالي</th>
                <th className="px-4 py-3 text-right font-semibold">المدفوع</th>
                <th className="px-4 py-3 text-right font-semibold">المتبقي</th>
                <th className="px-4 py-3 text-right font-semibold">إجراءات</th>
              </tr></thead>
              <tbody>
                {invoices.map((inv) => {
                  const remaining = (inv.total - inv.paid_amount) / 100;
                  const paid = inv.paid_amount / 100;
                  const total = inv.total / 100;
                  return (
                    <tr key={inv.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono text-slate-500 num">{inv.doc_number}</td>
                      <td className="px-4 py-3 text-slate-600 num">{formatShortDate(inv.date)}</td>
                      <td className="px-4 py-3"><Badge tone={DOC_TYPE_TONES[inv.doc_type]}>{DOC_TYPE_LABELS[inv.doc_type]}</Badge></td>
                      <td className="px-4 py-3 text-slate-700">{inv.party_name ?? '—'}</td>
                      <td className="px-4 py-3 num font-semibold text-slate-700">{formatEGP(total)}</td>
                      <td className="px-4 py-3 num text-emerald-600">{paid > 0 ? formatEGP(paid) : '—'}</td>
                      <td className="px-4 py-3 num">
                        {remaining > 0 ? <span className="text-rose-600">{formatEGP(remaining)}</span> : <Badge tone="emerald" dot>مسدد</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setViewInvoice(inv)} className="btn-ghost p-1.5" title="عرض"><Eye className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showModal && <InvoiceModal onClose={() => setShowModal(false)} onSaved={load} />}
      {viewInvoice && <InvoiceViewModal invoice={viewInvoice} onClose={() => setViewInvoice(null)} />}
    </div>
  );
}

function InvoiceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [parties, setParties] = useState<Party[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [docType, setDocType] = useState('sales');
  const [partyId, setPartyId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [items, setItems] = useState<{ description: string; quantity: string; unit: string; unitPrice: string; discount: string }[]>([
    { description: '', quantity: '1', unit: 'قطعة', unitPrice: '', discount: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listParties().then(setParties);
    listActivities().then(setActivities);
  }, []);

  const total = items.reduce((s, i) => (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0) - (parseFloat(i.discount) || 0), 0);

  function updateItem(idx: number, field: string, value: string) {
    const next = [...items]; next[idx] = { ...next[idx], [field]: value }; setItems(next);
  }
  function addItem() { setItems([...items, { description: '', quantity: '1', unit: 'قطعة', unitPrice: '', discount: '' }]); }
  function removeItem(idx: number) { if (items.length > 1) setItems(items.filter((_, i) => i !== idx)); }

  async function handleSave() {
    setError(null);
    if (!partyId) { setError('اختر الطرف'); return; }
    const validItems = items.filter((i) => i.description.trim() && parseFloat(i.unitPrice) > 0);
    if (validItems.length === 0) { setError('أضف بندًا واحدًا على الأقل'); return; }
    setSaving(true);
    try {
      await createInvoice({
        date, docType: docType as 'sales' | 'purchase' | 'sales_return' | 'purchase_return',
        partyId, activityId: activityId || null, paymentMethod,
        items: validItems.map((i) => ({ description: i.description, quantity: parseFloat(i.quantity) || 1, unit: i.unit, unitPrice: parseFloat(i.unitPrice), discount: parseFloat(i.discount) || 0 })),
        discount: 0, createdBy: user?.id ?? null,
      });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">فاتورة جديدة</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div><label className="text-xs font-semibold text-slate-600 mb-1 block">النوع</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="input-base">
              <option value="sales">مبيعات</option><option value="purchase">مشتريات</option>
              <option value="sales_return">مرتجع مبيعات</option><option value="purchase_return">مرتجع مشتريات</option>
            </select></div>
          <div><label className="text-xs font-semibold text-slate-600 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
          <div><label className="text-xs font-semibold text-slate-600 mb-1 block">الطرف</label>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="input-base">
              <option value="">اختر</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className="text-xs font-semibold text-slate-600 mb-1 block">الدفع</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input-base">
              <option value="cash">نقدي</option><option value="credit">آجل</option>
              <option value="transfer">تحويل</option><option value="check">شيك</option>
            </select></div>
        </div>
        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-600 mb-1 block">النشاط</label>
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base max-w-xs">
            <option value="">— عام —</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-slate-500 text-xs">
            <th className="text-right py-2 font-semibold">الصنف/الوصف</th>
            <th className="text-right py-2 font-semibold w-20">الكمية</th>
            <th className="text-right py-2 font-semibold w-20">الوحدة</th>
            <th className="text-right py-2 font-semibold w-28">سعر الوحدة</th>
            <th className="text-right py-2 font-semibold w-20">الخصم</th>
            <th className="w-10"></th>
          </tr></thead>
          <tbody>
            {items.map((item, idx) => {
              return (
                <tr key={idx}>
                  <td className="py-1"><input value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} className="input-base" placeholder="وصف الصنف" /></td>
                  <td className="py-1"><input type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} className="input-base num" /></td>
                  <td className="py-1"><input value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} className="input-base" /></td>
                  <td className="py-1"><input type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)} className="input-base num" /></td>
                  <td className="py-1"><input type="number" value={item.discount} onChange={(e) => updateItem(idx, 'discount', e.target.value)} className="input-base num" /></td>
                  <td className="py-1 text-center"><button onClick={() => removeItem(idx)} className="text-rose-400 hover:text-rose-600 p-1"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between mb-4">
          <button onClick={addItem} className="btn-ghost text-sm text-brand-600"><Plus className="h-4 w-4 inline" /> إضافة بند</button>
          <div className="text-left">
            <p className="text-sm text-slate-500">الإجمالي</p>
            <p className="text-lg font-bold text-slate-800 num">{formatEGP(total)}</p>
          </div>
        </div>
        {error && <div className="flex items-center gap-2 text-sm text-rose-600 mb-3"><AlertCircle className="h-4 w-4" />{error}</div>}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? 'جارٍ الحفظ...' : 'حفظ الفاتورة'}</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function InvoiceViewModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { user } = useSession();
  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remaining = (invoice.total - invoice.paid_amount) / 100;

  async function handlePayment() {
    setError(null);
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    if (amt > remaining) { setError('المبلغ أكبر من المتبقي'); return; }
    try {
      await recordPayment({
        invoiceId: invoice.id, partyId: invoice.party_id!, date: new Date().toISOString().slice(0, 10),
        amount: amt, paymentMethod: 'cash',
        direction: invoice.doc_type === 'sales' || invoice.doc_type === 'sales_return' ? 'inbound' : 'outbound',
        description: `سداد فاتورة ${invoice.doc_number}`, createdBy: user?.id ?? null,
      });
      setShowPayment(false); setPayAmount('');
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">فاتورة {invoice.doc_number}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div><span className="text-slate-500">النوع:</span> <Badge tone={DOC_TYPE_TONES[invoice.doc_type]}>{DOC_TYPE_LABELS[invoice.doc_type]}</Badge></div>
          <div><span className="text-slate-500">التاريخ:</span> <span className="text-slate-700 num">{formatShortDate(invoice.date)}</span></div>
          <div><span className="text-slate-500">الطرف:</span> <span className="text-slate-700">{invoice.party_name}</span></div>
          <div><span className="text-slate-500">الدفع:</span> <span className="text-slate-700">{invoice.payment_method}</span></div>
        </div>
        <table className="w-full text-sm mb-4">
          <thead><tr className="border-b border-slate-100 text-slate-500">
            <th className="text-right py-2 font-semibold">الوصف</th>
            <th className="text-right py-2 font-semibold">الكمية</th>
            <th className="text-right py-2 font-semibold">السعر</th>
            <th className="text-right py-2 font-semibold">الإجمالي</th>
          </tr></thead>
          <tbody>
            {invoice.items.map((it) => (
              <tr key={it.id} className="border-b border-slate-50">
                <td className="py-2 text-slate-700">{it.description}</td>
                <td className="py-2 num text-slate-600">{it.quantity} {it.unit}</td>
                <td className="py-2 num text-slate-600">{formatEGP(it.unit_price / 100)}</td>
                <td className="py-2 num text-slate-700 font-semibold">{formatEGP(it.total / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col items-end gap-1 text-sm">
          <div className="flex justify-between w-48"><span className="text-slate-500">الإجمالي:</span><span className="font-semibold num">{formatEGP(invoice.total / 100)}</span></div>
          <div className="flex justify-between w-48"><span className="text-slate-500">المدفوع:</span><span className="num text-emerald-600">{formatEGP(invoice.paid_amount / 100)}</span></div>
          <div className="flex justify-between w-48 border-t border-slate-200 pt-1"><span className="text-slate-500">المتبقي:</span><span className="font-bold num text-rose-600">{formatEGP(remaining)}</span></div>
        </div>
        {remaining > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            {!showPayment ? (
              <button onClick={() => setShowPayment(true)} className="btn-primary">تسجيل دفعة</button>
            ) : (
              <div className="flex items-end gap-2">
                <div><label className="text-sm font-semibold text-slate-700 mb-1 block">مبلغ الدفعة</label><input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="input-base num" /></div>
                <button onClick={handlePayment} className="btn-primary">تأكيد</button>
                <button onClick={() => setShowPayment(false)} className="btn-secondary">إلغاء</button>
              </div>
            )}
            {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
