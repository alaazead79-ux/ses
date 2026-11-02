import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, TrendingUp, TrendingDown, Banknote, Users, Building2, Boxes,
  Receipt, UserCircle, FileCheck, LayoutDashboard, AlertTriangle,
} from 'lucide-react';
import StatCard, { StatCardList } from '@/components/ui/StatCard';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { formatEGP, formatShortDate } from '@/lib/format';
import { getDashboardStats, getActivitySummaries, type DashboardStats, type ActivitySummary } from '@/services/reportService';
import { listChecks } from '@/services/financeService';
import { listProducts } from '@/services/inventoryService';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [alerts, setAlerts] = useState<{ type: string; message: string; severity: string }[]>([]);

  const load = useCallback(async () => {
    const [s, acts, checks, products] = await Promise.all([
      getDashboardStats(), getActivitySummaries(), listChecks(), listProducts(),
    ]);
    setStats(s); setActivities(acts);

    const newAlerts: { type: string; message: string; severity: string }[] = [];
    // تنبيهات الشيكات المستحقة
    checks.forEach((c) => {
      const days = Math.ceil((new Date(c.due_date).getTime() - Date.now()) / 86400000);
      if (days >= 0 && days <= 7 && c.status !== 'collected' && c.status !== 'paid' && c.status !== 'cancelled') {
        newAlerts.push({ type: 'check', message: `شيك ${c.direction === 'incoming' ? 'وارد' : 'صادر'} بقيمة ${formatEGP(c.amount / 100)} مستحق خلال ${days} يوم`, severity: 'amber' });
      }
    });
    // تنبيهات المخزون المنخفض
    products.forEach((p) => {
      if (p.quantity <= p.reorder_level) {
        newAlerts.push({ type: 'inventory', message: `الصنف "${p.name}" منخفض — المتوفر: ${p.quantity} ${p.unit}`, severity: 'rose' });
      }
    });
    setAlerts(newAlerts);
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasData = stats !== null && (stats.totalRevenues > 0 || stats.totalExpenses > 0 || stats.cashBalance > 0);

  return (
    <div>
      <PageHeader title="لوحة التحكم" subtitle={`آخر تحديث: ${formatShortDate(new Date())}`} icon={LayoutDashboard} />

      {!stats ? (
        <p className="text-sm text-slate-400 text-center py-8">جارٍ تحميل البيانات...</p>
      ) : (
        <>
          <StatCardList>
            <StatCard label="إجمالي الإيرادات" value={stats.totalRevenues} icon={TrendingUp} tone="emerald" />
            <StatCard label="إجمالي المصروفات" value={stats.totalExpenses} icon={TrendingDown} tone="rose" />
            <StatCard label={stats.netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'} value={stats.netProfit} icon={Banknote} tone={stats.netProfit >= 0 ? 'blue' : 'rose'} />
            <StatCard label="رصيد الخزينة" value={stats.cashBalance} icon={Wallet} tone="emerald" />
          </StatCardList>
          <div className="h-4" />
          <StatCardList>
            <StatCard label="مستحقات العملاء" value={stats.totalReceivables} icon={Users} tone="amber" />
            <StatCard label="مستحقات الموردين" value={stats.totalPayables} icon={Building2} tone="violet" />
            <StatCard label="قيمة المشتريات" value={stats.totalPurchases} icon={Receipt} tone="slate" />
            <StatCard label="قيمة المبيعات" value={stats.totalSales} icon={Banknote} tone="emerald" />
          </StatCardList>
          <div className="h-4" />
          <StatCardList>
            <StatCard label="قيمة المخزون" value={stats.inventoryValue} icon={Boxes} tone="blue" />
            <StatCard label="الرواتب المستحقة" value={stats.salariesDue} icon={UserCircle} tone="amber" />
            <StatCard label="السلف المستحقة" value={stats.advancesDue} icon={Banknote} tone="rose" />
            <StatCard label="الشيكات المستحقة" value={stats.checksDue} icon={FileCheck} tone="violet" />
          </StatCardList>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="card p-5">
          <h3 className="font-semibold text-slate-800 mb-4">مؤشرات النشاط</h3>
          {activities.length === 0 || activities.every((a) => a.revenues === 0 && a.expenses === 0) ? (
            <EmptyState icon={LayoutDashboard} title="لا توجد بيانات" description="ستظهر مؤشرات النشاط بعد بدء تسجيل العمليات." />
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 text-slate-500">
                <th className="px-3 py-2 text-right font-semibold">النشاط</th>
                <th className="px-3 py-2 text-right font-semibold">الإيرادات</th>
                <th className="px-3 py-2 text-right font-semibold">المصروفات</th>
                <th className="px-3 py-2 text-right font-semibold">الربح</th>
              </tr></thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.activity_id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 text-slate-700">{a.activity_name}</td>
                    <td className="px-3 py-2 num text-emerald-600">{formatEGP(a.revenues)}</td>
                    <td className="px-3 py-2 num text-rose-600">{formatEGP(a.expenses)}</td>
                    <td className={`px-3 py-2 num font-semibold ${a.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatEGP(a.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">التنبيهات</h3>
            <Badge tone={alerts.length > 0 ? 'amber' : 'slate'} dot>{alerts.length} تنبيه</Badge>
          </div>
          {alerts.length === 0 ? (
            <EmptyState icon={FileCheck} title="لا توجد تنبيهات" description="تظهر هنا تنبيهات المخزون والشيكات المستحقة." />
          ) : (
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
                  <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${a.severity === 'rose' ? 'text-rose-500' : 'text-amber-500'}`} />
                  <span className="text-slate-700">{a.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {!hasData && (
        <div className="mt-6 card p-6 text-center">
          <p className="text-sm text-slate-500">لا توجد بيانات مالية بعد. ابدأ بتسجيل مصروف أو فاتورة أو حركة خزينة لرؤية المؤشرات الفعلية هنا.</p>
        </div>
      )}
      <p className="mt-6 text-center text-xs text-slate-400">جميع المبالغ بالجنيه المصري (ج.م)</p>
    </div>
  );
}
