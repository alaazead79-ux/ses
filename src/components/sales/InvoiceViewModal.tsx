import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP, formatShortDate } from '@/lib/format';
import { getDesktopApi } from '@/lib/electronBridge';
import {
  cancelInvoice, listCashboxOptions, recordPayment,
  type CashboxOption, type Invoice,
} from '@/services/invoiceService';
import { DOC_TYPE_LABELS, DOC_TYPE_TONES } from './invoiceLabels';
import InvoiceReturnModal from './InvoiceReturnModal';

export default function InvoiceViewModal({ invoice, onClose, onChanged }: {
  invoice: Invoice; onClose: () => void; onChanged: () => void;
}) {
  const { user, hasPermission } = useSession();
  const [showPayment, setShowPayment] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'transfer'>('cash');
  const [cashboxId, setCashboxId] = useState('');
  const [cashboxes, setCashboxes] = useState<CashboxOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDesktop = getDesktopApi() !== null;
  const isOpen = invoice.status === 'posted';
  const remaining = (invoice.total - invoice.paid_amount) / 100;
  const isStockDoc = invoice.doc_type === 'sales' || invoice.doc_type === 'purchase';

  useEffect(() => {
    listCashboxOptions().then(setCashboxes).catch((e: unknown) => setError(e instanceof Error ? e.message : 'تعذر تحميل الخزائن'));
  }, []);

  async function handlePayment() {
    setError(null);
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    if (amount > remaining) { setError('المبلغ أكبر من المتبقي'); return; }
    if (isDesktop && !cashboxId) { setError('اختر الخزينة'); return; }
    setBusy(true);
    try {
      await recordPayment({
        invoiceId: invoice.id, cashboxId: cashboxId || undefined, partyId: invoice.party_id!,
        date: new Date().toISOString().slice(0, 10), amount, paymentMethod: payMethod,
        direction: invoice.doc_type === 'sales' ? 'inbound' : 'outbound',
        description: `سداد فاتورة ${invoice.doc_number}`, createdBy: user?.id ?? null,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setError(null);
    setBusy(true);
    try {
      await cancelInvoice(invoice.id, new Date().toISOString().slice(0, 10));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ');
      setConfirmCancel(false);
    } finally {
      setBusy(false);
    }
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
          <div><span className="text-slate-500">الحالة:</span> {isOpen ? <Badge tone="emerald" dot>مرحّلة</Badge> : <Badge tone="rose">ملغاة</Badge>}</div>
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
          <div className="flex justify-between w-48 border-t border-slate-200 pt-1"><span className="text-slate-500">المتبقي:</span><span className="font-bold num text-rose-600">{formatEGP(isOpen ? remaining : 0)}</span></div>
        </div>

        {isOpen && isDesktop && isStockDoc && hasPermission('sales.add') && remaining > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            {!showPayment ? (
              <button onClick={() => setShowPayment(true)} className="btn-primary">تسجيل دفعة</button>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <div><label className="text-xs font-semibold text-slate-600 mb-1 block">الخزينة</label>
                  <select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} className="input-base">
                    <option value="">اختر</option>
                    {cashboxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
                  </select></div>
                <div><label className="text-xs font-semibold text-slate-600 mb-1 block">الطريقة</label>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'cash' | 'transfer')} className="input-base">
                    <option value="cash">نقدي</option><option value="transfer">تحويل</option>
                  </select></div>
                <div><label className="text-xs font-semibold text-slate-600 mb-1 block">المبلغ</label>
                  <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="input-base num" /></div>
                <div className="flex gap-2">
                  <button onClick={handlePayment} disabled={busy} className="btn-primary flex-1">تأكيد</button>
                  <button onClick={() => setShowPayment(false)} className="btn-secondary">إلغاء</button>
                </div>
              </div>
            )}
          </div>
        )}

        {isOpen && isDesktop && isStockDoc && hasPermission('sales.add') && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2">
            <button onClick={() => setShowReturn(true)} className="btn-secondary">تسجيل مرتجع</button>
          </div>
        )}

        {isOpen && isDesktop && isStockDoc && hasPermission('sales.edit') && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            {!confirmCancel ? (
              <button onClick={() => setConfirmCancel(true)} className="btn-ghost text-rose-600">إلغاء الفاتورة</button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-700">سيُعكس قيد الفاتورة وتُعاد الأصناف والمدفوعات. هل تريد المتابعة؟</span>
                <button onClick={handleCancel} disabled={busy} className="btn-primary bg-rose-600 hover:bg-rose-700">نعم، ألغِ الفاتورة</button>
                <button onClick={() => setConfirmCancel(false)} className="btn-secondary">تراجع</button>
              </div>
            )}
          </div>
        )}

        {error && <div className="flex items-center gap-2 text-sm text-rose-600 mt-3"><AlertCircle className="h-4 w-4" />{error}</div>}
      </div>
      {showReturn && (
        <InvoiceReturnModal
          invoice={invoice}
          onClose={() => setShowReturn(false)}
          onDone={() => { setShowReturn(false); onChanged(); }}
        />
      )}
    </div>
  );
}
