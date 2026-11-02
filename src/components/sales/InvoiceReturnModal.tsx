import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { createReturn, type Invoice, type InvoiceItem } from '@/services/invoiceService';

function remainingOf(item: InvoiceItem): number {
  return Math.max(0, item.quantity - (item.returnedQuantity ?? 0));
}

export default function InvoiceReturnModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const lines = invoice.items.filter((item) => item.product_id && remainingOf(item) > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const returnLabel = invoice.doc_type === 'sales' ? 'مرتجع مبيعات' : 'مرتجع مشتريات';

  async function handleSave() {
    setError(null);
    const selected: { productId: string; quantity: number }[] = [];
    for (const line of lines) {
      const quantity = parseFloat(quantities[line.id] ?? '');
      if (!quantity) continue;
      const remaining = remainingOf(line);
      if (quantity < 0 || quantity > remaining) {
        setError(`الكمية المرتجعة لـ ${line.description ?? 'الصنف'} يجب ألا تتجاوز المتبقي (${remaining})`);
        return;
      }
      selected.push({ productId: line.product_id!, quantity });
    }
    if (selected.length === 0) { setError('أدخل كمية لصنف واحد على الأقل'); return; }
    setSaving(true);
    try {
      await createReturn({ invoice, date: new Date().toISOString().slice(0, 10), reason: reason.trim() || undefined, items: selected });
      onDone();
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
          <h3 className="font-bold text-slate-800">{returnLabel} من الفاتورة {invoice.doc_number}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-slate-600 mb-4">تم إرجاع كل كميات هذه الفاتورة، ولا يوجد ما يمكن إرجاعه.</p>
        ) : (
          <table className="w-full text-sm mb-4">
            <thead><tr className="border-b border-slate-100 text-slate-500">
              <th className="text-right py-2 font-semibold">الصنف</th>
              <th className="text-right py-2 font-semibold">الأصلية</th>
              <th className="text-right py-2 font-semibold">مرتجع سابقًا</th>
              <th className="text-right py-2 font-semibold">المتبقي</th>
              <th className="text-right py-2 font-semibold w-32">الكمية المرتجعة</th>
            </tr></thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-slate-50">
                  <td className="py-2 text-slate-700">{line.description}</td>
                  <td className="py-2 num text-slate-600">{line.quantity} {line.unit}</td>
                  <td className="py-2 num text-slate-600">{line.returnedQuantity ?? 0}</td>
                  <td className="py-2 num font-semibold text-slate-800">{remainingOf(line)}</td>
                  <td className="py-2">
                    <input
                      type="number" min="0" max={remainingOf(line)} step="0.001"
                      value={quantities[line.id] ?? ''}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      className="input-base num"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-600 mb-1 block">سبب المرتجع (اختياري)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="input-base" />
        </div>
        {error && <div className="flex items-center gap-2 text-sm text-rose-600 mb-3"><AlertCircle className="h-4 w-4" />{error}</div>}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving || lines.length === 0} className="btn-primary flex-1">{saving ? 'جارٍ الحفظ...' : 'تسجيل المرتجع'}</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
