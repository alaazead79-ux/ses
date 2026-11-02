import { NAV_ITEMS } from '@/lib/navigation';
import type { NavItem } from '@/lib/navigation';
import type { PageId } from '@/lib/types';
import { ChevronLeft, X } from 'lucide-react';
import { useSession } from '@/context/SessionContext';

interface SidebarProps {
  current: PageId;
  onNavigate: (id: PageId) => void;
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ current, onNavigate, open, onClose }: SidebarProps) {
  const { hasPermission } = useSession();
  const visibleItems = NAV_ITEMS.filter((i) => hasPermission(i.permission));
  const visibleGroups = Array.from(new Set(visibleItems.map((i) => i.group)));
  return (
    <>
      {/* خلفية معتمة على الجوال */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed lg:sticky top-0 z-40 h-screen w-72 shrink-0 flex flex-col
          bg-white border-l border-slate-200 transition-transform duration-300
          ${open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
      >
        {/* الشعار + الاسم */}
        <div className="flex items-center justify-between gap-3 px-5 h-16 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center h-10 w-10 rounded-xl bg-brand-600 text-white font-bold text-lg shadow-sm">
              م
            </div>
            <div className="leading-tight">
              <p className="font-bold text-slate-800 text-sm">مزرعة المواشي</p>
              <p className="text-xs text-slate-500">نظام الحسابات والإدارة</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden text-slate-400 hover:text-slate-600 rounded-lg p-1.5 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* القائمة */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {visibleGroups.map((group) => (
            <div key={group}>
              <p className="px-3 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {group}
              </p>
              <ul className="space-y-0.5">
                {visibleItems.filter((i) => i.group === group).map((item: NavItem) => {
                  const active = current === item.id;
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => onNavigate(item.id)}
                        className={`group w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition
                          ${
                            active
                              ? 'bg-brand-50 text-brand-700'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                          }`}
                      >
                        <Icon
                          className={`h-5 w-5 shrink-0 ${active ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'}`}
                        />
                        <span className="flex-1 text-right">{item.label}</span>
                        {active && <ChevronLeft className="h-4 w-4 text-brand-500" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* تذييل */}
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400 text-center">
          نظام الحسابات — يعمل محليًا
        </div>
      </aside>
    </>
  );
}
