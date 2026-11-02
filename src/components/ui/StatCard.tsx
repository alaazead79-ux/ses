import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatEGP } from '@/lib/format';

interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: 'emerald' | 'blue' | 'amber' | 'rose' | 'slate' | 'violet';
  trend?: { value: number; positive: boolean };
  empty?: boolean;
}

const TONES: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
  violet: 'bg-violet-50 text-violet-600',
};

export default function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'emerald',
  trend,
  empty = false,
}: StatCardProps) {
  return (
    <div className="card p-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {empty ? (
          <p className="mt-2 text-2xl font-bold text-slate-300 num">—</p>
        ) : (
          <p className="mt-1 text-2xl font-bold text-slate-800 num">{formatEGP(value)}</p>
        )}
        {trend && (
          <div
            className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${
              trend.positive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {trend.positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            <span className="num">{trend.value}%</span>
            <span className="text-slate-400 font-normal">عن الفترة السابقة</span>
          </div>
        )}
      </div>
      <div className={`shrink-0 rounded-xl p-3 ${TONES[tone]}`}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  );
}

export function StatCardList({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {children}
    </div>
  );
}
