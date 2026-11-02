import { useState, useEffect, useCallback } from 'react';
import { FileBarChart, Scale, TrendingUp, Wallet, Printer, Download } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { formatEGP } from '@/lib/format';
import { getProfitLoss, getActivitySummaries, type ProfitLossReport, type ActivitySummary } from '@/services/reportService';
import { getTrialBalance, type TrialBalanceRow } from '@/services/accountingService';
import { listCashTransactions } from '@/services/treasuryService';

type ReportType = 'profit_loss' | 'trial_balance' | 'activity_summary' | 'cash_flow' | 'balance_sheet';

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('profit_loss');
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (reportType === 'profit_loss') {
        setData(await getProfitLoss());
      } else if (reportType === 'trial_balance') {
        setData(await getTrialBalance());
      } else if (reportType === 'activity_summary') {
        setData(await getActivitySummaries());
      } else if (reportType === 'cash_flow') {
        setData(await listCashTransactions(500));
      } else {
        setData(null);
      }
    } finally { setLoading(false); }
  }, [reportType]);

  useEffect(() => { load(); }, [load]);

  const reports: { id: ReportType; label: string; icon: typeof FileBarChart }[] = [
    { id: 'profit_loss', label: 'الأرباح والخسائر', icon: TrendingUp },
    { id: 'trial_balance', label: 'ميزان المراجعة', icon: Scale },
    { id: 'activity_summary', label: 'تقرير الأنشطة', icon: FileBarChart },
    { id: 'cash_flow', label: 'حركة الخزينة', icon: Wallet },
  ];

  function handlePrint() { window.print(); }

  return (
    <div>
      <PageHeader title="التقارير" subtitle="تقارير قابلة للتصفية — تدعم الطباعة" icon={FileBarChart}
        actions={
          <>
            <button onClick={handlePrint} className="btn-secondary"><Printer className="h-4 w-4" /> طباعة</button>
            <button onClick={handlePrint} className="btn-primary"><Download className="h-4 w-4" /> PDF</button>
          </>
        }
      />
      <div className="flex gap-2 mb-4 flex-wrap">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <button key={r.id} onClick={() => setReportType(r.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition
                ${reportType === r.id ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4" />{r.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">جارٍ تحميل التقرير...</p>
      ) : reportType === 'profit_loss' ? (
        <ProfitLossReport data={data as ProfitLossReport} />
      ) : reportType === 'trial_balance' ? (
        <TrialBalanceReport data={data as { rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number }} />
      ) : reportType === 'activity_summary' ? (
        <ActivityReport data={data as ActivitySummary[]} />
      ) : reportType === 'cash_flow' ? (
        <CashFlowReport data={data as Array<{ doc_number: string; date: string; type: string; party_name: string | null; description: string | null; amount: number }>} />
      ) : null}
    </div>
  );
}

function ProfitLossReport({ data }: { data: ProfitLossReport | null }) {
  if (!data) return <EmptyState icon={TrendingUp} title="لا توجد بيانات" />;
  return (
    <div className="card p-6">
      <h3 className="font-bold text-slate-800 mb-4 text-center">قائمة الأرباح والخسائر</h3>
      <table className="w-full text-sm">
        <tbody>
          <tr><td colSpan={2} className="py-2 font-bold text-slate-700 border-b border-slate-100">الإيرادات</td></tr>
          {data.revenues.length === 0 ? <tr><td className="py-2 text-slate-400">لا توجد إيرادات</td><td></td></tr> :
            data.revenues.map((r, i) => (
              <tr key={i} className="border-b border-slate-50"><td className="py-2 text-slate-700">{r.account}</td><td className="py-2 num text-emerald-600">{formatEGP(r.amount)}</td></tr>
            ))}
          <tr className="font-semibold"><td className="py-2 text-slate-700">إجمالي الإيرادات</td><td className="py-2 num text-emerald-700">{formatEGP(data.totalRevenues)}</td></tr>
          <tr><td colSpan={2} className="py-2 font-bold text-slate-700 border-b border-slate-100 border-t-2 border-slate-200">المصروفات</td></tr>
          {data.expenses.length === 0 ? <tr><td className="py-2 text-slate-400">لا توجد مصروفات</td><td></td></tr> :
            data.expenses.map((r, i) => (
              <tr key={i} className="border-b border-slate-50"><td className="py-2 text-slate-700">{r.account}</td><td className="py-2 num text-rose-600">{formatEGP(r.amount)}</td></tr>
            ))}
          <tr className="font-semibold"><td className="py-2 text-slate-700">إجمالي المصروفات</td><td className="py-2 num text-rose-700">{formatEGP(data.totalExpenses)}</td></tr>
          <tr className="border-t-2 border-slate-200 font-bold text-base"><td className="py-3 text-slate-800">{data.netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</td><td className={`py-3 num ${data.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatEGP(data.netProfit)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function TrialBalanceReport({ data }: { data: { rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number } | null }) {
  if (!data) return <EmptyState icon={Scale} title="لا توجد بيانات" />;
  const balanced = data.totalDebit === data.totalCredit;
  return (
    <div className="card overflow-hidden">
      <h3 className="font-bold text-slate-800 mb-4 text-center p-4">ميزان المراجعة</h3>
      {data.rows.length === 0 ? <EmptyState icon={Scale} title="لا توجد قيود" /> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
            <th className="px-4 py-3 text-right font-semibold">الكود</th><th className="px-4 py-3 text-right font-semibold">الحساب</th>
            <th className="px-4 py-3 text-right font-semibold">مدين</th><th className="px-4 py-3 text-right font-semibold">دائن</th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.account_id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-3 font-mono num text-slate-500">{r.code}</td><td className="px-4 py-3 text-slate-700">{r.name}</td>
                <td className="px-4 py-3 num text-emerald-600">{r.debit > 0 ? formatEGP(r.debit / 100) : '—'}</td>
                <td className="px-4 py-3 num text-rose-600">{r.credit > 0 ? formatEGP(r.credit / 100) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-200 font-bold bg-slate-50">
            <td className="px-4 py-3" colSpan={2}>الإجمالي</td>
            <td className="px-4 py-3 num">{formatEGP(data.totalDebit / 100)}</td><td className="px-4 py-3 num">{formatEGP(data.totalCredit / 100)}</td>
          </tr></tfoot>
        </table>
      )}
      <div className="px-5 py-3 border-t border-slate-100">
        {balanced ? <Badge tone="emerald" dot>متوازن</Badge> : <Badge tone="rose" dot>غير متوازن — فرق {formatEGP(Math.abs(data.totalDebit - data.totalCredit) / 100)}</Badge>}
      </div>
    </div>
  );
}

function ActivityReport({ data }: { data: ActivitySummary[] | null }) {
  if (!data) return <EmptyState icon={FileBarChart} title="لا توجد بيانات" />;
  return (
    <div className="card overflow-hidden">
      <h3 className="font-bold text-slate-800 mb-4 text-center p-4">تقرير الأرباح حسب النشاط</h3>
      {data.length === 0 ? <EmptyState icon={FileBarChart} title="لا توجد أنشطة" /> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
            <th className="px-4 py-3 text-right font-semibold">النشاط</th><th className="px-4 py-3 text-right font-semibold">الإيرادات</th>
            <th className="px-4 py-3 text-right font-semibold">المصروفات</th><th className="px-4 py-3 text-right font-semibold">الربح/الخسارة</th>
          </tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.activity_id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-3 text-slate-700 font-semibold">{a.activity_name}</td>
                <td className="px-4 py-3 num text-emerald-600">{formatEGP(a.revenues)}</td>
                <td className="px-4 py-3 num text-rose-600">{formatEGP(a.expenses)}</td>
                <td className={`px-4 py-3 num font-semibold ${a.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatEGP(a.profit)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 font-bold bg-slate-50">
              <td className="px-4 py-3">الإجمالي</td>
              <td className="px-4 py-3 num">{formatEGP(data.reduce((s, a) => s + a.revenues, 0))}</td>
              <td className="px-4 py-3 num">{formatEGP(data.reduce((s, a) => s + a.expenses, 0))}</td>
              <td className="px-4 py-3 num">{formatEGP(data.reduce((s, a) => s + a.profit, 0))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function CashFlowReport({ data }: { data: Array<{ doc_number: string; date: string; type: string; party_name: string | null; description: string | null; amount: number }> | null }) {
  if (!data) return <EmptyState icon={Wallet} title="لا توجد بيانات" />;
  const totalIn = data.filter((t) => ['receipt', 'deposit', 'opening'].includes(t.type)).reduce((s, t) => s + t.amount / 100, 0);
  const totalOut = data.filter((t) => ['payment', 'withdrawal'].includes(t.type)).reduce((s, t) => s + t.amount / 100, 0);
  return (
    <div className="card overflow-hidden">
      <h3 className="font-bold text-slate-800 mb-4 text-center p-4">تقرير حركة الخزينة</h3>
      <div className="flex gap-6 px-5 pb-3 border-b border-slate-100">
        <span className="text-sm"><span className="text-slate-500">إجمالي الوارد: </span><span className="font-bold num text-emerald-600">{formatEGP(totalIn)}</span></span>
        <span className="text-sm"><span className="text-slate-500">إجمالي الصادر: </span><span className="font-bold num text-rose-600">{formatEGP(totalOut)}</span></span>
        <span className="text-sm"><span className="text-slate-500">الصافي: </span><span className="font-bold num">{formatEGP(totalIn - totalOut)}</span></span>
      </div>
      {data.length === 0 ? <EmptyState icon={Wallet} title="لا توجد حركات" /> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
            <th className="px-4 py-3 text-right font-semibold">التاريخ</th><th className="px-4 py-3 text-right font-semibold">النوع</th>
            <th className="px-4 py-3 text-right font-semibold">البيان</th><th className="px-4 py-3 text-right font-semibold">المبلغ</th>
          </tr></thead>
          <tbody>
            {data.map((t) => {
              const isIn = ['receipt', 'deposit', 'opening'].includes(t.type);
              return (
                <tr key={t.doc_number} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 num text-slate-600">{t.date}</td>
                  <td className="px-4 py-3"><Badge tone={isIn ? 'emerald' : 'rose'}>{t.type}</Badge></td>
                  <td className="px-4 py-3 text-slate-600">{t.description ?? t.party_name ?? '—'}</td>
                  <td className={`px-4 py-3 num font-semibold ${isIn ? 'text-emerald-600' : 'text-rose-600'}`}>{isIn ? '+' : '−'}{formatEGP(t.amount / 100)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
