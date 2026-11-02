import { useState, useEffect, useCallback } from 'react';
import { TrendingDown, TrendingUp, X, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { useSession } from '@/context/SessionContext';
import { formatEGP, formatShortDate } from '@/lib/format';
import { listExpenses, listIncomes, createExpense, createIncome, listExpenseCategories, listIncomeCategories, type Expense, type Income, type ExpenseCategory, type IncomeCategory } from '@/services/expensesService';
import { listActivities, type Activity } from '@/services/activityService';

export default function ExpensesPage() {
  const { hasPermission } = useSession();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);

  const load = useCallback(async () => {
    const [e, i] = await Promise.all([listExpenses(), listIncomes()]);
    setExpenses(e); setIncomes(i);
  }, []);
  useEffect(() => { load(); }, [load]);

  const canAdd = hasPermission('expenses.add');

  return (
    <div>
      <PageHeader title="المصروفات والإيرادات" subtitle="تسجيل سريع وتفصيلي مرتبط بالنشاط والحساب" icon={TrendingDown}
        actions={canAdd ? (
          <>
            <button onClick={() => setShowIncomeModal(true)} className="btn-secondary"><TrendingUp className="h-4 w-4" /> إيراد</button>
            <button onClick={() => setShowExpenseModal(true)} className="btn-primary"><TrendingDown className="h-4 w-4" /> مصروف</button>
          </>
        ) : undefined}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100"><h3 className="font-semibold text-slate-800">المصروفات</h3></div>
          {expenses.length === 0 ? (
            <EmptyState icon={TrendingDown} title="لا توجد مصروفات" description="تُسجَّل المصروفات هنا وترتبط تلقائيًا بالنشاط والحساب." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                  <th className="px-4 py-2 text-right font-semibold">التاريخ</th><th className="px-4 py-2 text-right font-semibold">الفئة</th>
                  <th className="px-4 py-2 text-right font-semibold">البيان</th><th className="px-4 py-2 text-right font-semibold">المبلغ</th>
                </tr></thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 num text-slate-600">{formatShortDate(e.date)}</td>
                      <td className="px-4 py-2 text-slate-700">{e.category_name ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-600">{e.description ?? '—'}</td>
                      <td className="px-4 py-2 num font-semibold text-rose-600">{formatEGP(e.amount / 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100"><h3 className="font-semibold text-slate-800">الإيرادات</h3></div>
          {incomes.length === 0 ? (
            <EmptyState icon={TrendingUp} title="لا توجد إيرادات" description="تُسجَّل الإيرادات هنا وترتبط تلقائيًا بالنشاط والحساب." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                  <th className="px-4 py-2 text-right font-semibold">التاريخ</th><th className="px-4 py-2 text-right font-semibold">الفئة</th>
                  <th className="px-4 py-2 text-right font-semibold">البيان</th><th className="px-4 py-2 text-right font-semibold">المبلغ</th>
                </tr></thead>
                <tbody>
                  {incomes.map((i) => (
                    <tr key={i.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 num text-slate-600">{formatShortDate(i.date)}</td>
                      <td className="px-4 py-2 text-slate-700">{i.category_name ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-600">{i.description ?? '—'}</td>
                      <td className="px-4 py-2 num font-semibold text-emerald-600">{formatEGP(i.amount / 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {showExpenseModal && <ExpenseModal onClose={() => setShowExpenseModal(false)} onSaved={load} />}
      {showIncomeModal && <IncomeModal onClose={() => setShowIncomeModal(false)} onSaved={load} />}
    </div>
  );
}

function ExpenseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [activityId, setActivityId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listExpenseCategories().then((c) => { setCategories(c); if (c[0]) setCategoryId(c[0].id); });
    listActivities().then(setActivities);
  }, []);

  async function handleSave() {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    if (!categoryId) { setError('اختر الفئة'); return; }
    try {
      await createExpense({ date, categoryId, amount: amt, activityId: activityId || null, paymentMethod, description, createdBy: user?.id ?? null });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">مصروف جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الفئة</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-base">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">المبلغ (ج.م)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">طريقة الدفع</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input-base">
              <option value="cash">نقدي</option><option value="credit">آجل</option><option value="transfer">تحويل</option>
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النشاط</label>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base">
              <option value="">— عام —</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">البيان</label><input value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" /></div>
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

function IncomeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [categories, setCategories] = useState<IncomeCategory[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [activityId, setActivityId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listIncomeCategories().then((c) => { setCategories(c); if (c[0]) setCategoryId(c[0].id); });
    listActivities().then(setActivities);
  }, []);

  async function handleSave() {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    if (!categoryId) { setError('اختر الفئة'); return; }
    try {
      await createIncome({ date, categoryId, amount: amt, activityId: activityId || null, description, createdBy: user?.id ?? null });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">إيراد جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الفئة</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-base">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">المبلغ (ج.م)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النشاط</label>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base">
              <option value="">— عام —</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">البيان</label><input value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" /></div>
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
