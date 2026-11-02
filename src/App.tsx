import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/components/dashboard/Dashboard';
import { SessionProvider, useSession } from '@/context/SessionContext';
import { useDbInit } from '@/hooks/useDbInit';
import LoginPage from '@/pages/LoginPage';
import type { PageId } from '@/lib/types';
import TreasuryPage from '@/pages/TreasuryPage';
import TransfersPage from '@/pages/TransfersPage';
import ChecksPage from '@/pages/ChecksPage';
import SalesPage from '@/pages/SalesPage';
import PartiesPage from '@/pages/PartiesPage';
import ExpensesPage from '@/pages/ExpensesPage';
import InventoryPage from '@/pages/InventoryPage';
import AccountingPage from '@/pages/AccountingPage';
import EmployeesPage from '@/pages/EmployeesPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';
import BackupPage from '@/pages/BackupPage';
import ImportPage from '@/pages/ImportPage';

function AppInner() {
  const { user, checking } = useSession();
  const { ready, error } = useDbInit();
  const [page, setPage] = useState<PageId>('dashboard');

  if (!ready || checking) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50">
        <div className="text-center">
          <div className="animate-pulse h-12 w-12 rounded-xl bg-brand-600 mx-auto mb-4" />
          <p className="text-sm text-slate-500">جارٍ تهيئة قاعدة البيانات المحلية...</p>
          {error && <p className="text-xs text-rose-500 mt-2">{error}</p>}
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  function renderPage() {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      case 'treasury': return <TreasuryPage />;
      case 'transfers': return <TransfersPage />;
      case 'checks': return <ChecksPage />;
      case 'sales': return <SalesPage />;
      case 'parties': return <PartiesPage />;
      case 'expenses': return <ExpensesPage />;
      case 'inventory': return <InventoryPage />;
      case 'accounting': return <AccountingPage />;
      case 'employees': return <EmployeesPage />;
      case 'reports': return <ReportsPage />;
      case 'settings': return <SettingsPage />;
      case 'backup': return <BackupPage />;
      case 'import': return <ImportPage />;
      default: return <Dashboard />;
    }
  }

  return (
    <AppLayout current={page} onNavigate={setPage}>
      {renderPage()}
    </AppLayout>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <AppInner />
    </SessionProvider>
  );
}
