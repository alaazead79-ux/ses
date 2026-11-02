import type { ReactNode } from 'react';
import { Sprout } from 'lucide-react';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export default function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="grid place-items-center h-16 w-16 rounded-2xl bg-brand-600 text-white shadow-lg shadow-emerald-600/20 mb-4">
            <Sprout className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>

        <div className="card p-8">{children}</div>

        <p className="text-center text-xs text-slate-400 mt-6">
          البرنامج يعمل محليًا دون اتصال بالإنترنت — جميع البيانات محفوظة على جهازك
        </p>
      </div>
    </div>
  );
}
