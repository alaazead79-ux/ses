import { useState, useEffect, useCallback } from 'react';
import { UserCircle, Plus, X, AlertCircle, Calendar, Banknote, HandCoins } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP, formatShortDate } from '@/lib/format';
import {
  listEmployees, createEmployee,
  listSalaryRecords, generatePayroll, paySalary, listAdvances, createAdvance,
  listAttendance, recordAttendance,
  type Employee, type SalaryRecord, type EmployeeAdvance, type Attendance,
} from '@/services/employeeService';
import { listActivities, type Activity } from '@/services/activityService';

type Tab = 'employees' | 'attendance' | 'salaries' | 'advances';

export default function EmployeesPage() {
  const { hasPermission } = useSession();
  const [tab, setTab] = useState<Tab>('employees');

  const tabs: { id: Tab; label: string; icon: typeof UserCircle }[] = [
    { id: 'employees', label: 'الموظفون', icon: UserCircle },
    { id: 'attendance', label: 'الحضور', icon: Calendar },
    { id: 'salaries', label: 'الرواتب', icon: Banknote },
    { id: 'advances', label: 'السلف', icon: HandCoins },
  ];

  return (
    <div>
      <PageHeader title="الموظفون والرواتب" subtitle="ملفات الموظفين، الحضور، مسير الرواتب، السلف والخصومات" icon={UserCircle} />
      <div className="flex gap-2 mb-4 border-b border-slate-200 overflow-x-auto">
        {tabs.map((t) => {
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
      {tab === 'employees' && <EmployeesTab canAdd={hasPermission('employees.add')} />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'salaries' && <SalariesTab canAdd={hasPermission('employees.add')} />}
      {tab === 'advances' && <AdvancesTab canAdd={hasPermission('employees.add')} />}
    </div>
  );
}

function EmployeesTab({ canAdd }: { canAdd: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => listEmployees().then(setEmployees), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800">الموظفون</h3>
        {canAdd && <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> موظف جديد</button>}
      </div>
      {employees.length === 0 ? (
        <EmptyState icon={UserCircle} title="لا يوجد موظفون" description="يُسجَّل هنا كل موظف مع بياناته وراتبه وطريقة احتسابه." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
              <th className="px-4 py-3 text-right font-semibold">الاسم</th><th className="px-4 py-3 text-right font-semibold">الوظيفة</th>
              <th className="px-4 py-3 text-right font-semibold">الهاتف</th><th className="px-4 py-3 text-right font-semibold">الراتب</th>
              <th className="px-4 py-3 text-right font-semibold">الحالة</th>
            </tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 text-slate-700 font-semibold">{e.name}</td>
                  <td className="px-4 py-3 text-slate-600">{e.job_title ?? '—'}</td>
                  <td className="px-4 py-3 num text-slate-600">{e.phone ?? '—'}</td>
                  <td className="px-4 py-3 num text-slate-700">{formatEGP(e.base_salary / 100)}</td>
                  <td className="px-4 py-3">{e.status === 'active' ? <Badge tone="emerald" dot>نشط</Badge> : <Badge tone="slate" dot>متوقف</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && <EmployeeModal onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

function EmployeeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [salaryType, setSalaryType] = useState('monthly');
  const [activityId, setActivityId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listActivities().then(setActivities); }, []);

  async function handleSave() {
    setError(null);
    if (!name.trim()) { setError('اسم الموظف مطلوب'); return; }
    try {
      await createEmployee({ name: name.trim(), phone, jobTitle, hireDate, baseSalary: parseFloat(baseSalary) || 0, salaryType, activityId: activityId || null });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">موظف جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} className="input-base" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الوظيفة</label><input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="input-base" /></div>
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الهاتف</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-base num" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">تاريخ التعيين</label><input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className="input-base" /></div>
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">طريقة الراتب</label>
              <select value={salaryType} onChange={(e) => setSalaryType(e.target.value)} className="input-base">
                <option value="monthly">شهري</option><option value="daily">يومي</option><option value="hourly">ساعي</option>
              </select></div>
          </div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الراتب الأساسي (ج.م)</label><input type="number" value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} className="input-base num" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النشاط</label>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base">
              <option value="">— عام —</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
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

function AttendanceTab() {
  const [records, setRecords] = useState<Attendance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empId, setEmpId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('present');

  const load = useCallback(async () => {
    const [a, e] = await Promise.all([listAttendance(), listEmployees()]);
    setRecords(a); setEmployees(e);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleRecord() {
    if (!empId) return;
    await recordAttendance({ employeeId: empId, date, status });
    load(); setEmpId('');
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-end gap-3">
        <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الموظف</label>
          <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="input-base">
            <option value="">اختر</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select></div>
        <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
        <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الحالة</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-base">
            <option value="present">حاضر</option><option value="absent">غائب</option>
            <option value="late">متأخر</option><option value="leave">إجازة</option>
          </select></div>
        <button onClick={handleRecord} disabled={!empId} className="btn-primary">تسجيل</button>
      </div>
      <div className="card overflow-hidden">
        {records.length === 0 ? (
          <EmptyState icon={Calendar} title="لا توجد سجلات حضور" description="تسجَّل هنا الحضور والغياب والتأخير والإجازات." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-2 text-right font-semibold">الموظف</th><th className="px-4 py-2 text-right font-semibold">التاريخ</th>
                <th className="px-4 py-2 text-right font-semibold">الحالة</th>
              </tr></thead>
              <tbody>
                {records.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 text-slate-700">{r.employee_name}</td>
                    <td className="px-4 py-2 num text-slate-600">{formatShortDate(r.date)}</td>
                    <td className="px-4 py-2"><Badge tone={r.status === 'present' ? 'emerald' : r.status === 'absent' ? 'rose' : 'amber'}>{r.status === 'present' ? 'حاضر' : r.status === 'absent' ? 'غائب' : r.status === 'late' ? 'متأخر' : 'إجازة'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SalariesTab({ canAdd }: { canAdd: boolean }) {
  const { user } = useSession();
  const [records, setRecords] = useState<SalaryRecord[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = useCallback(() => listSalaryRecords(month).then(setRecords), [month]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-end gap-3">
        <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الشهر</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input-base" /></div>
        {canAdd && <button onClick={async () => { await generatePayroll({ month: month + '-01', createdBy: user?.id ?? null }); load(); }} className="btn-primary">إنشاء مسير</button>}
      </div>
      <div className="card overflow-hidden">
        {records.length === 0 ? (
          <EmptyState icon={Banknote} title="لا يوجد مسير رواتب" description="أنشئ مسير الرواتب الشهري من الزر أعلاه." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                <th className="px-4 py-3 text-right font-semibold">الموظف</th><th className="px-4 py-3 text-right font-semibold">الشهر</th>
                <th className="px-4 py-3 text-right font-semibold">الأساسي</th><th className="px-4 py-3 text-right font-semibold">الصافي</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة</th><th className="px-4 py-3 text-right font-semibold">إجراء</th>
              </tr></thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 text-slate-700 font-semibold">{r.employee_name}</td>
                    <td className="px-4 py-3 num text-slate-600">{formatShortDate(r.month)}</td>
                    <td className="px-4 py-3 num text-slate-600">{formatEGP(r.base_salary / 100)}</td>
                    <td className="px-4 py-3 num font-semibold text-slate-700">{formatEGP(r.net_salary / 100)}</td>
                    <td className="px-4 py-3">{r.status === 'paid' ? <Badge tone="emerald" dot>مدفوع</Badge> : <Badge tone="amber" dot>معلق</Badge>}</td>
                    <td className="px-4 py-3">
                      {r.status === 'pending' && canAdd && <button onClick={async () => { await paySalary(r.id, user?.id ?? null); load(); }} className="btn-secondary text-xs py-1">صرف</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdvancesTab({ canAdd }: { canAdd: boolean }) {
  const [advances, setAdvances] = useState<EmployeeAdvance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    const [a, e] = await Promise.all([listAdvances(), listEmployees()]);
    setAdvances(a); setEmployees(e);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800">السلف</h3>
        {canAdd && <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> سلفة جديدة</button>}
      </div>
      {advances.length === 0 ? (
        <EmptyState icon={HandCoins} title="لا توجد سلف" description="تُسجَّل هنا السلف مع طريقة السداد والأقساط." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
              <th className="px-4 py-3 text-right font-semibold">الموظف</th><th className="px-4 py-3 text-right font-semibold">التاريخ</th>
              <th className="px-4 py-3 text-right font-semibold">المبلغ</th><th className="px-4 py-3 text-right font-semibold">المتبقي</th>
              <th className="px-4 py-3 text-right font-semibold">الحالة</th>
            </tr></thead>
            <tbody>
              {advances.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 text-slate-700 font-semibold">{a.employee_name}</td>
                  <td className="px-4 py-3 num text-slate-600">{formatShortDate(a.date)}</td>
                  <td className="px-4 py-3 num text-slate-700">{formatEGP(a.amount / 100)}</td>
                  <td className="px-4 py-3 num font-semibold">{formatEGP(a.remaining / 100)}</td>
                  <td className="px-4 py-3">{a.status === 'active' ? <Badge tone="amber" dot>نشطة</Badge> : <Badge tone="emerald" dot>مسددة</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && <AdvanceModal employees={employees} onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

function AdvanceModal({ employees, onClose, onSaved }: { employees: Employee[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [empId, setEmpId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const amt = parseFloat(amount);
    if (!empId) { setError('اختر الموظف'); return; }
    if (!amt || amt <= 0) { setError('أدخل مبلغًا صحيحًا'); return; }
    try {
      await createAdvance({ employeeId: empId, date, amount: amt, createdBy: user?.id ?? null });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">سلفة جديدة</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الموظف</label>
            <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="input-base">
              <option value="">اختر</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">المبلغ (ج.م)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base num" /></div>
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
