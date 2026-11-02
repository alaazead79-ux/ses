import { useState, useEffect } from 'react';
import { AlertCircle, Plus, Trash2, X } from 'lucide-react';
import { useSession } from '@/context/SessionContext';
import { formatEGP } from '@/lib/format';
import {
  createInvoice, listCashboxOptions, listSellableProducts,
  type CashboxOption, type SellableProduct,
} from '@/services/invoiceService';
import { listParties, type Party } from '@/services/partyService';
import { listActivities, type Activity } from '@/services/activityService';
import { getDesktopApi } from '@/lib/electronBridge';

interface FormItem {
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
}

const EMPTY_ITEM: FormItem = { productId: '', description: '', quantity: '1', unit: '', unitPrice: '', discount: '' };

export default function InvoiceFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [parties, setParties] = useState<Party[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [products, setProducts] = useState<SellableProduct[]>([]);
  const [cashboxes, setCashboxes] = useState<CashboxOption[]>([]);
  const [docType, setDocType] = useState<'sales' | 'purchase'>('sales');
  const [partyId, setPartyId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashboxId, setCashboxId] = useState('');
  const [paidNow, setPaidNow] = useState('');
  const [items, setItems] = useState<FormItem[]>([EMPTY_ITEM]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDesktop = getDesktopApi() !== null;
  const needsCashbox = paymentMethod === 'cash' || paymentMethod === 'transfer';

  useEffect(() => {
    listParties().then(setParties);
    listActivities().then(setActivities);
    listSellableProducts().then(setProducts).catch((e: unknown) => setError(e instanceof Error ? e.message : 'تعذر تحميل الأصناف'));
    listCashboxOptions().then(setCashboxes).catch((e: unknown) => setError(e instanceof Error ? e.message : 'تعذر تحميل الخزائن'));
  }, []);

  const total = items.reduce((s, i) => (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0) - (parseFloat(i.discount) || 0), 0);

  function updateItem(idx: number, patch: Partial<FormItem>) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  }

  function pickProduct(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    updateItem(idx, { productId, description: product?.name ?? '', unit: product?.unit ?? '' });
  }

  async function handleSave() {
    setError(null);
    if (!partyId) { setError('اختر الطرف'); return; }
    const validItems = items.filter((i) => i.productId && parseFloat(i.quantity) > 0 && parseFloat(i.unitPrice) > 0);
    if (validItems.length === 0) { setError('أضف صنفًا واحدًا على الأقل بكمية وسعر'); return; }
    if (needsCashbox && !cashboxId && isDesktop) { setError('اختر الخزينة'); return; }
    setSaving(true);
    try {
      await createInvoice({
        date, docType, partyId, activityId: activityId || null, paymentMethod,
        items: validItems.map((i) => ({
          productId: i.productId, description: i.description, quantity: parseFloat(i.quantity),
          unit: i.unit, unitPrice: parseFloat(i.unitPrice), discount: parseFloat(i.discount) || 0,
        })),
        discount: 0,
        createdBy: user?.id ?? null,
        cashboxId: needsCashbox && cashboxId ? cashboxId : undefined,
        paidNow: needsCashbox && paidNow.trim() !== '' ? parseFloat(paidNow) : undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
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
            <select value={docType} onChange={(e) => setDocType(e.target.value as 'sales' | 'purchase')} className="input-base">
              <option value="sales">مبيعات</option><option value="purchase">مشتريات</option>
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
        {needsCashbox && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div><label className="text-xs font-semibold text-slate-600 mb-1 block">الخزينة</label>
              <select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} className="input-base">
                <option value="">اختر الخزينة</option>
                {cashboxes.map((box) => <option key={box.id} value={box.id}>{box.name} ({formatEGP(box.balance / 100)})</option>)}
              </select></div>
            <div><label className="text-xs font-semibold text-slate-600 mb-1 block">المدفوع الآن (اتركه فارغًا لدفع الكامل)</label>
              <input type="number" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} className="input-base num" /></div>
          </div>
        )}
        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-600 mb-1 block">النشاط</label>
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base max-w-xs">
            <option value="">— عام —</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-slate-500 text-xs">
            <th className="text-right py-2 font-semibold">الصنف</th>
            <th className="text-right py-2 font-semibold w-20">الكمية</th>
            <th className="text-right py-2 font-semibold w-28">سعر الوحدة</th>
            <th className="text-right py-2 font-semibold w-20">الخصم</th>
            <th className="w-10"></th>
          </tr></thead>
          <tbody>
            {items.map((item, idx) => {
              const product = products.find((p) => p.id === item.productId);
              return (
                <tr key={idx}>
                  <td className="py-1">
                    <select value={item.productId} onChange={(e) => pickProduct(idx, e.target.value)} className="input-base">
                      <option value="">اختر الصنف</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {product && <p className="text-xs text-slate-400 mt-1 num">المتوفر: {product.quantity} {product.unit}</p>}
                  </td>
                  <td className="py-1"><input type="number" value={item.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} className="input-base num" /></td>
                  <td className="py-1"><input type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, { unitPrice: e.target.value })} className="input-base num" /></td>
                  <td className="py-1"><input type="number" value={item.discount} onChange={(e) => updateItem(idx, { discount: e.target.value })} className="input-base num" /></td>
                  <td className="py-1 text-center">
                    <button onClick={() => items.length > 1 && setItems(items.filter((_, i) => i !== idx))} className="text-rose-400 hover:text-rose-600 p-1"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setItems([...items, EMPTY_ITEM])} className="btn-ghost text-sm text-brand-600"><Plus className="h-4 w-4 inline" /> إضافة بند</button>
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
