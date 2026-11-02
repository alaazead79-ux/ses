import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, X, AlertCircle, FileText, Edit2, Eye } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP } from '@/lib/format';
import { listParties, createParty, deleteParty, getPartyStatement, type Party, type PartyStatementRow } from '@/services/partyService';
import { listActivities, type Activity } from '@/services/activityService';

export default function PartiesPage() {
  const { hasPermission } = useSession();
  const [parties, setParties] = useState<Party[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [statementParty, setStatementParty] = useState<Party | null>(null);

  const load = useCallback(() => listParties().then(setParties), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="العملاء والموردون" subtitle="سجل العملاء والموردين وكشوف الحسابات" icon={Users}
        actions={hasPermission('parties.add') ? <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> طرف جديد</button> : undefined}
      />
      <div className="card overflow-hidden">
        {parties.length === 0 ? (
          <EmptyState icon={Users} title="لا يوجد عملاء أو موردون" description="يُسجَّل هنا كل عميل ومورد مع الرصيد الافتتاحي وبيانات التواصل وكشف الحساب." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">الاسم</th>
                <th className="px-4 py-3 text-right font-semibold">النوع</th>
                <th className="px-4 py-3 text-right font-semibold">الهاتف</th>
                <th className="px-4 py-3 text-right font-semibold">الرصيد</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                <th className="px-4 py-3 text-right font-semibold">إجراءات</th>
              </tr></thead>
              <tbody>
                {parties.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-slate-700 font-semibold">{p.name}</td>
                    <td className="px-4 py-3">
                      <Badge tone={p.type === 'customer' ? 'emerald' : p.type === 'supplier' ? 'amber' : 'blue'}>
                        {p.type === 'customer' ? 'عميل' : p.type === 'supplier' ? 'مورد' : 'الاثنان'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600 num">{p.phone ?? '—'}</td>
                    <td className="px-4 py-3 num font-semibold">
                      <span className={p.balance > 0 ? 'text-emerald-600' : p.balance < 0 ? 'text-rose-600' : 'text-slate-500'}>
                        {formatEGP(p.balance / 100)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{p.status === 'active' ? <Badge tone="emerald" dot>نشط</Badge> : <Badge tone="slate" dot>متوقف</Badge>}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setStatementParty(p)} className="btn-ghost p-1.5" title="كشف حساب"><Eye className="h-4 w-4" /></button>
                        {hasPermission('parties.delete') && <button onClick={async () => { if (confirm('حذف هذا الطرف؟')) { try { await deleteParty(p.id); load(); } catch (e) { alert(e instanceof Error ? e.message : 'تعذر حذف الطرف'); } } }} className="btn-ghost p-1.5 text-rose-500"><Edit2 className="h-4 w-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showModal && <PartyModal onClose={() => setShowModal(false)} onSaved={load} />}
      {statementParty && <StatementModal party={statementParty} onClose={() => setStatementParty(null)} />}
    </div>
  );
}

function PartyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('customer');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityId, setActivityId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listActivities().then(setActivities); }, []);

  async function handleSave() {
    setError(null);
    if (!name.trim()) { setError('اسم الطرف مطلوب'); return; }
    try {
      await createParty({ name: name.trim(), type, phone, address, openingBalance: parseFloat(openingBalance) || 0, notes, activityId: activityId || null });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">طرف جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النوع</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="input-base">
              <option value="customer">عميل</option>
              <option value="supplier">مورد</option>
              <option value="both">عميل ومورد</option>
            </select>
          </div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الهاتف</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">العنوان</label><input value={address} onChange={(e) => setAddress(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الرصيد الافتتاحي (ج.م)</label><input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النشاط</label>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base">
              <option value="">— عام —</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">ملاحظات</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input-base" rows={2} /></div>
          {error && <div className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle className="h-4 w-4" />{error}</div>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} className="btn-primary flex-1">حفظ</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function StatementModal({ party, onClose }: { party: Party; onClose: () => void }) {
  const [rows, setRows] = useState<PartyStatementRow[] | null>(null);
  const [closing, setClosing] = useState(0);

  useEffect(() => {
    getPartyStatement(party.id).then((r) => { setRows(r.rows); setClosing(r.closing); });
  }, [party.id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">كشف حساب: {party.name}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        {!rows ? <p className="text-sm text-slate-400 text-center py-8">جارٍ التحميل...</p> : rows.length <= 1 ? (
          <EmptyState icon={FileText} title="لا توجد حركات" description="لا توجد معاملات لهذا الطرف." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
              <th className="px-3 py-2 text-right font-semibold">التاريخ</th>
              <th className="px-3 py-2 text-right font-semibold">البيان</th>
              <th className="px-3 py-2 text-right font-semibold">مدين</th>
              <th className="px-3 py-2 text-right font-semibold">دائن</th>
              <th className="px-3 py-2 text-right font-semibold">الرصيد</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 text-slate-600">{r.date || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{r.description}</td>
                  <td className="px-3 py-2 num text-emerald-600">{r.debit > 0 ? formatEGP(r.debit / 100) : '—'}</td>
                  <td className="px-3 py-2 num text-rose-600">{r.credit > 0 ? formatEGP(r.credit / 100) : '—'}</td>
                  <td className="px-3 py-2 num font-semibold text-slate-700">{formatEGP(r.balance / 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 font-bold text-slate-800 bg-slate-50">
              <td className="px-3 py-2" colSpan={2}>الرصيد الختامي</td>
              <td className="px-3 py-2" colSpan={3}>{formatEGP(closing / 100)}</td>
            </tr></tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
