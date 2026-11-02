import { useState } from 'react';
import { Menu, Bell, Search, CircleUser as UserCircle, LogOut, KeyRound } from 'lucide-react';
import { useSession } from '@/context/SessionContext';
import { ROLES } from '@/lib/types';
import ChangePasswordDialog from '@/components/auth/ChangePasswordDialog';

interface TopbarProps {
  title: string;
  onMenuClick: () => void;
}

export default function Topbar({ title, onMenuClick }: TopbarProps) {
  const { user, signOut } = useSession();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const roleLabel = ROLES.find((r) => r.id === user?.roleId)?.label ?? user?.roleLabel ?? '';

  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200 h-16 flex items-center gap-4 px-4 sm:px-6">
      <button onClick={onMenuClick} className="lg:hidden text-slate-600 rounded-lg p-2 hover:bg-slate-100">
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex-1 min-w-0">
        <h2 className="text-base font-semibold text-slate-800 truncate">{title}</h2>
      </div>

      <div className="hidden md:block relative w-64">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input placeholder="بحث سريع..." className="input-base pr-9 py-1.5 text-sm bg-slate-50" />
      </div>

      <button className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition">
        <Bell className="h-5 w-5" />
        <span className="absolute top-1.5 left-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
      </button>

      <div className="flex items-center gap-2">
        <div className="grid place-items-center h-8 w-8 rounded-full bg-brand-50 text-brand-600">
          <UserCircle className="h-5 w-5" />
        </div>
        <div className="hidden sm:block text-right leading-tight">
          <p className="text-sm font-semibold text-slate-700">{user?.displayName ?? 'غير معروف'}</p>
          <p className="text-[11px] text-slate-400">{roleLabel}</p>
        </div>
        <button
          onClick={() => setPasswordOpen(true)}
          className="rounded-lg p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition"
          title="تغيير كلمة المرور"
        >
          <KeyRound className="h-4 w-4" />
        </button>
        <button
          onClick={signOut}
          className="rounded-lg p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
          title="تسجيل الخروج"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      {passwordOpen && <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />}
    </header>
  );
}
