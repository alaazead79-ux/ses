import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Plus, FileText, Scale, BookCopy, Trash2, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP } from '@/lib/format';
import {
  listAccounts, createAccount, createJournalEntry, listJournalEntries,
  getTrialBalance, getGeneralLedger, type Account, type JournalEntry, type TrialBalanceRow,
} from '@/services/accountingService';

type Tab = 'chart' | 'journal' | 'ledger' | 'trial' | 'opening';

export default function AccountingPage() {
  const { hasPermission } = useSession();
  const [tab, setTab] = useState<Tab>('chart');

  const tabs: { id: Tab; label: string; icon: typeof BookOpen; perm: string }[] = [
    { id: 'chart', label: 'دليل الحسابات', icon: BookCopy, perm: 'accounting.view' },
    { id: 'journal', label: 'القيود اليومية', icon: FileText, perm: 'accounting.view' },
    { id: 'ledger', label: 'الأستاذ العام', icon: BookOpen, perm: 'accounting.view' },
    { id: 'trial', label: 'ميزان المراجعة', icon: Scale, perm: 'accounting.view' },
    { id: 'opening', label: 'الأرصدة الافتتاحية', icon: Plus, perm: 'accounting.view' },
  ];
  const visibleTabs = tabs.filter((t) => hasPermission(t.perm));

  return (
    <div>
      <PageHeader title="الحسابات العامة" subtitle="محاسبة مزدوجة: دليل الحسابات، القيود، الأستاذ، ميزان المراجعة، الأرصدة الافتتاحية" icon={BookOpen}
        actions={hasPermission('accounting.add') ? <button onClick={() => setTab('journal')} className="btn-primary"><Plus className="h-4 w-4" /> قيد جديد</button> : undefined}
      />
      <div className="flex gap-2 mb-4 border-b border-slate-200 overflow-x-auto">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition whitespace-nowrap
                ${tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>
      {tab === 'chart' && <ChartTab canAdd={hasPermission('accounting.add')} />}
      {tab === 'journal' && <JournalTab canAdd={hasPermission('accounting.add')} />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'trial' && <TrialTab />}
      {tab === 'opening' && <OpeningTab canAdd={hasPermission('accounting.add')} />}
    </div>
  );
}

// ===================== دليل الحسابات =====================
function ChartTab({ canAdd }: { canAdd: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => listAccounts().then(setAccounts), []);
  useEffect(() => { load(); }, [load]);

  const typeLabels: Record<string, string> = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' };
  const typeTones: Record<string, 'emerald' | 'amber' | 'blue' | 'violet' | 'rose'> = { asset: 'emerald', liability: 'amber', equity: 'blue', revenue: 'violet', expense: 'rose' };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800">دليل الحسابات</h3>
        {canAdd && <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> حساب جديد</button>}
      </div>
      {accounts.length === 0 ? (
        <EmptyState icon={BookCopy} title="لا توجد حسابات" description="سيظهر دليل الحسابات هنا." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">الكود</th>
                <th className="px-4 py-3 text-right font-semibold">الاسم</th>
                <th className="px-4 py-3 text-right font-semibold">النوع</th>
                <th className="px-4 py-3 text-right font-semibold">الرصيد</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-mono text-slate-600 num">{a.code}</td>
                  <td className="px-4 py-3 text-slate-700">{a.name}</td>
                  <td className="px-4 py-3"><Badge tone={typeTones[a.type]}>{typeLabels[a.type] ?? a.type}</Badge></td>
                  <td className="px-4 py-3 num text-slate-700">{formatEGP(a.balance / 100)}</td>
                  <td className="px-4 py-3">{a.is_active ? <Badge tone="emerald" dot>نشط</Badge> : <Badge tone="slate" dot>متوقف</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && <AccountModal onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

function AccountModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('expense');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!code.trim() || !name.trim()) { setError('يرجى إدخال الكود والاسم'); return; }
    try {
      await createAccount({ code: code.trim(), name: name.trim(), type });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">حساب جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الكود</label><input value={code} onChange={(e) => setCode(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النوع</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="input-base">
              <option value="asset">أصول</option>
              <option value="liability">خصوم</option>
              <option value="equity">حقوق ملكية</option>
              <option value="revenue">إيرادات</option>
              <option value="expense">مصروفات</option>
            </select>
          </div>
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

// ===================== القيود اليومية =====================
function JournalTab({ canAdd }: { canAdd: boolean }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => listJournalEntries(100).then(setEntries), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      {canAdd && (
        <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> قيد جديد</button>
      )}
      {entries.length === 0 ? (
        <div className="card"><EmptyState icon={FileText} title="لا توجد قيود" description="تنشأ القيود المزدوجة هنا يدويًا أو تلقائيًا من الفواتير والمصروفات." /></div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <div key={e.id} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-slate-500 num">{e.entry_number}</span>
                  <span className="text-sm text-slate-600">{e.date}</span>
                  {e.status === 'posted' && <Badge tone="emerald" dot>مرحّل</Badge>}
                  {e.status === 'reversed' && <Badge tone="rose" dot>ملغى</Badge>}
                </div>
                <span className="text-xs text-slate-400">{e.description}</span>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-slate-400 text-xs"><th className="text-right py-1 font-normal">الحساب</th><th className="text-right py-1 font-normal">مدين</th><th className="text-right py-1 font-normal">دائن</th></tr></thead>
                <tbody>
                  {e.lines.map((l) => (
                    <tr key={l.id} className="border-t border-slate-50">
                      <td className="py-1.5 text-slate-700"><span className="font-mono text-xs text-slate-400 num">{l.account_code}</span> {l.account_name}</td>
                      <td className="py-1.5 num text-emerald-600">{l.debit > 0 ? formatEGP(l.debit / 100) : '—'}</td>
                      <td className="py-1.5 num text-rose-600">{l.credit > 0 ? formatEGP(l.credit / 100) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-200 font-bold text-slate-700">
                    <td className="py-2">الإجمالي</td>
                    <td className="py-2 num">{formatEGP(e.lines.reduce((s, l) => s + l.debit, 0) / 100)}</td>
                    <td className="py-2 num">{formatEGP(e.lines.reduce((s, l) => s + l.credit, 0) / 100)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {showModal && <JournalModal onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

function JournalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<{ accountId: string; debit: string; credit: string }[]>([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { listAccounts().then((a) => setAccounts(a.filter((x) => x.is_active))); }, []);

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  function updateLine(idx: number, field: string, value: string) {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    setLines(next);
  }
  function addLine() { setLines([...lines, { accountId: '', debit: '', credit: '' }]); }
  function removeLine(idx: number) { if (lines.length > 2) setLines(lines.filter((_, i) => i !== idx)); }

  async function handleSave() {
    setError(null);
    if (!balanced) { setError('القيد غير متوازن. يجب أن يتساوى المدين مع الدائن.'); return; }
    const validLines = lines.filter((l) => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (validLines.length < 2) { setError('يجب وجود سطرين على الأقل'); return; }
    setSaving(true);
    try {
      await createJournalEntry({
        date, description,
        lines: validLines.map((l) => ({ accountId: l.accountId, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 })),
        createdBy: user?.id ?? null,
      });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">قيد محاسبي جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الوصف</label><input value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" /></div>
        </div>
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-slate-500 text-xs">
            <th className="text-right py-2 font-semibold">الحساب</th>
            <th className="text-right py-2 font-semibold w-32">مدين</th>
            <th className="text-right py-2 font-semibold w-32">دائن</th>
            <th className="w-10"></th>
          </tr></thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td className="py-1"><select value={l.accountId} onChange={(e) => updateLine(idx, 'accountId', e.target.value)} className="input-base">
                  <option value="">اختر الحساب</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select></td>
                <td className="py-1"><input type="number" value={l.debit} onChange={(e) => updateLine(idx, 'debit', e.target.value)} className="input-base num" disabled={!!parseFloat(l.credit)} /></td>
                <td className="py-1"><input type="number" value={l.credit} onChange={(e) => updateLine(idx, 'credit', e.target.value)} className="input-base num" disabled={!!parseFloat(l.debit)} /></td>
                <td className="py-1 text-center"><button onClick={() => removeLine(idx)} className="text-rose-400 hover:text-rose-600 p-1"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-200 font-bold text-slate-700">
            <td className="py-2"><button onClick={addLine} className="btn-ghost text-sm text-brand-600"><Plus className="h-4 w-4 inline" /> إضافة سطر</button></td>
            <td className="py-2 num">{totalDebit.toFixed(2)}</td>
            <td className="py-2 num">{totalCredit.toFixed(2)}</td>
            <td></td>
          </tr></tfoot>
        </table>
        <div className="flex items-center gap-2 mb-4">
          {balanced ? <Badge tone="emerald" dot>متوازن</Badge> : <Badge tone="rose" dot>غير متوازن</Badge>}
          <span className="text-xs text-slate-500">الفرق: {Math.abs(totalDebit - totalCredit).toFixed(2)} ج.م</span>
        </div>
        {error && <div className="flex items-center gap-2 text-sm text-rose-600 mb-3"><AlertCircle className="h-4 w-4" />{error}</div>}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving || !balanced} className="btn-primary flex-1">{saving ? 'جارٍ الحفظ...' : 'ترحيل القيد'}</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ===================== الأستاذ العام =====================
function LedgerTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [result, setResult] = useState<{ account: Account; rows: { date: string; entry_number: string; description: string | null; debit: number; credit: number; balance: number }[]; opening: number; closing: number } | null>(null);

  useEffect(() => { listAccounts().then((a) => setAccounts(a.filter((x) => x.is_active))); }, []);

  async function handleShow() {
    if (!accountId) return;
    const r = await getGeneralLedger(accountId);
    setResult(r);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="text-sm font-semibold text-slate-700 mb-1 block">اختر الحساب</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-base">
            <option value="">— اختر —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        <button onClick={handleShow} disabled={!accountId} className="btn-primary">عرض</button>
      </div>
      {result && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">أستاذ حساب: {result.account.name} ({result.account.code})</h3>
          </div>
          {result.rows.length <= 1 ? (
            <EmptyState icon={BookOpen} title="لا توجد حركات" description="لا توجد قيود لهذا الحساب." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                  <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                  <th className="px-4 py-3 text-right font-semibold">رقم القيد</th>
                  <th className="px-4 py-3 text-right font-semibold">البيان</th>
                  <th className="px-4 py-3 text-right font-semibold">مدين</th>
                  <th className="px-4 py-3 text-right font-semibold">دائن</th>
                  <th className="px-4 py-3 text-right font-semibold">الرصيد</th>
                </tr></thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-slate-600">{r.date || '—'}</td>
                      <td className="px-4 py-3 font-mono text-slate-500 num">{r.entry_number || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{r.description}</td>
                      <td className="px-4 py-3 num text-emerald-600">{r.debit > 0 ? formatEGP(r.debit / 100) : '—'}</td>
                      <td className="px-4 py-3 num text-rose-600">{r.credit > 0 ? formatEGP(r.credit / 100) : '—'}</td>
                      <td className="px-4 py-3 num font-semibold text-slate-700">{formatEGP(r.balance / 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===================== ميزان المراجعة =====================
function TrialTab() {
  const [result, setResult] = useState<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleShow() {
    setLoading(true);
    try { setResult(await getTrialBalance()); }
    finally { setLoading(false); }
  }

  useEffect(() => { handleShow(); }, []);

  const balanced = result ? result.totalDebit === result.totalCredit : false;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">ميزان المراجعة</h3>
        <button onClick={handleShow} disabled={loading} className="btn-secondary text-sm">تحديث</button>
      </div>
      {!result || result.rows.length === 0 ? (
        <EmptyState icon={Scale} title="لا توجد بيانات" description="سيظهر ميزان المراجعة بعد ترحيل القيود." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">الكود</th>
                <th className="px-4 py-3 text-right font-semibold">الحساب</th>
                <th className="px-4 py-3 text-right font-semibold">مدين</th>
                <th className="px-4 py-3 text-right font-semibold">دائن</th>
              </tr></thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.account_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono num text-slate-500">{r.code}</td>
                    <td className="px-4 py-3 text-slate-700">{r.name}</td>
                    <td className="px-4 py-3 num text-emerald-600">{r.debit > 0 ? formatEGP(r.debit / 100) : '—'}</td>
                    <td className="px-4 py-3 num text-rose-600">{r.credit > 0 ? formatEGP(r.credit / 100) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t-2 border-slate-200 font-bold text-slate-800 bg-slate-50">
                <td className="px-4 py-3" colSpan={2}>الإجمالي</td>
                <td className="px-4 py-3 num">{formatEGP(result.totalDebit / 100)}</td>
                <td className="px-4 py-3 num">{formatEGP(result.totalCredit / 100)}</td>
              </tr></tfoot>
            </table>
          </div>
          <div className="px-5 py-3 flex items-center gap-2 border-t border-slate-100">
            {balanced ? <Badge tone="emerald" dot><CheckCircle2 className="h-3 w-3 inline" /> متوازن</Badge> : <Badge tone="rose" dot><AlertCircle className="h-3 w-3 inline" /> غير متوازن</Badge>}
            <span className="text-xs text-slate-500">الفرق: {result ? Math.abs(result.totalDebit - result.totalCredit) / 100 : 0} ج.م</span>
          </div>
        </>
      )}
    </div>
  );
}

// ===================== الأرصدة الافتتاحية =====================
function OpeningTab({ canAdd }: { canAdd: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [debit, setDebit] = useState('');
  const [credit, setCredit] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listAccounts().then((a) => setAccounts(a.filter((x) => x.is_active))); }, []);

  async function handleSave() {
    setError(null);
    if (!accountId) { setError('اختر الحساب'); return; }
    const d = parseFloat(debit) || 0, c = parseFloat(credit) || 0;
    if (d === 0 && c === 0) { setError('أدخل قيمة'); return; }
    if (d > 0 && c > 0) { setError('أدخل مدين أو دائن، ليس كلاهما'); return; }
    try {
      const { setOpeningBalance } = await import('@/services/accountingService');
      await setOpeningBalance({ accountId, debit: d, credit: c, date });
      setSaved(true); setAccountId(''); setDebit(''); setCredit('');
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="card p-6 max-w-xl">
      <h3 className="font-semibold text-slate-800 mb-4">تسجيل رصيد افتتاحي</h3>
      <div className="space-y-3">
        <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الحساب</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-base">
            <option value="">اختر الحساب</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">مدين</label><input type="number" value={debit} onChange={(e) => setDebit(e.target.value)} disabled={!!parseFloat(credit)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">دائن</label><input type="number" value={credit} onChange={(e) => setCredit(e.target.value)} disabled={!!parseFloat(debit)} className="input-base num" /></div>
        </div>
        <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
        {error && <div className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle className="h-4 w-4" />{error}</div>}
      </div>
      <div className="mt-4 flex items-center gap-3">
        {canAdd && <button onClick={handleSave} className="btn-primary">حفظ الرصيد</button>}
        {saved && <Badge tone="emerald" dot>تم الحفظ</Badge>}
      </div>
    </div>
  );
}
