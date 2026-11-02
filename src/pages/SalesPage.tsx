import { useState, useEffect, useCallback } from 'react';
import { Receipt, Plus, Eye, Wallet } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP, formatShortDate } from '@/lib/format';
import { listInvoices, type Invoice } from '@/services/invoiceService';
import InvoiceFormModal from '@/components/sales/InvoiceFormModal';
import InvoiceViewModal from '@/components/sales/InvoiceViewModal';
import CustomerRefundModal from '@/components/sales/CustomerRefundModal';
import { DOC_TYPE_LABELS, DOC_TYPE_TONES } from '@/components/sales/invoiceLabels';
import { getDesktopApi } from '@/lib/electronBridge';

export default function SalesPage() {
  const { hasPermission } = useSession();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);

  const load = useCallback(() => listInvoices().then(setInvoices), []);
  useEffect(() => { load(); }, [load]);

  const viewInvoice = invoices.find((inv) => inv.id === viewInvoiceId) ?? null;
  const canAdd = hasPermission('sales.add');
  const canRefundCredit = hasPermission('treasury.add') && getDesktopApi() !== null;

  return (
    <div>
      <PageHeader title="المبيعات والمشتريات" subtitle="فواتير المبيعات والمشتريات والمرتجعات والمدفوعات" icon={Receipt}
        actions={(
          <div className="flex gap-2">
            {canRefundCredit && <button onClick={() => setShowRefund(true)} className="btn-secondary"><Wallet className="h-4 w-4" /> رد رصيد عميل</button>}
            {canAdd && <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> فاتورة جديدة</button>}
          </div>
        )}
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
                  const cancelled = inv.status === 'cancelled';
                  return (
                    <tr key={inv.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono text-slate-500 num">{inv.doc_number}</td>
                      <td className="px-4 py-3 text-slate-600 num">{formatShortDate(inv.date)}</td>
                      <td className="px-4 py-3"><Badge tone={DOC_TYPE_TONES[inv.doc_type]}>{DOC_TYPE_LABELS[inv.doc_type]}</Badge></td>
                      <td className="px-4 py-3 text-slate-700">{inv.party_name ?? '—'}</td>
                      <td className="px-4 py-3 num font-semibold text-slate-700">{formatEGP(total)}</td>
                      <td className="px-4 py-3 num text-emerald-600">{paid > 0 ? formatEGP(paid) : '—'}</td>
                      <td className="px-4 py-3 num">
                        {cancelled ? <Badge tone="rose">ملغاة</Badge>
                          : remaining > 0 ? <span className="text-rose-600">{formatEGP(remaining)}</span>
                          : <Badge tone="emerald" dot>مسدد</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setViewInvoiceId(inv.id)} className="btn-ghost p-1.5" title="عرض"><Eye className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showModal && <InvoiceFormModal onClose={() => setShowModal(false)} onSaved={load} />}
      {showRefund && (
        <CustomerRefundModal
          onClose={() => setShowRefund(false)}
          onDone={() => { setShowRefund(false); load(); }}
        />
      )}
      {viewInvoice && (
        <InvoiceViewModal
          invoice={viewInvoice}
          onClose={() => setViewInvoiceId(null)}
          onChanged={() => { setViewInvoiceId(null); load(); }}
        />
      )}
    </div>
  );
}
