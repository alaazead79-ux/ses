import { useState } from 'react';
import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import type { PageId } from '@/lib/types';
import { NAV_ITEMS } from '@/lib/navigation';

interface AppLayoutProps {
  current: PageId;
  onNavigate: (id: PageId) => void;
  children: ReactNode;
}

export default function AppLayout({ current, onNavigate, children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const currentItem = NAV_ITEMS.find((i) => i.id === current);

  const handleNavigate = (id: PageId) => {
    onNavigate(id);
    setSidebarOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        current={current}
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={currentItem?.label ?? 'لوحة التحكم'} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
