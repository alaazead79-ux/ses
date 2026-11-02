import { useSession } from '@/context/SessionContext';
import { CircleAlert as AlertCircle, MonitorX } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';
import OwnerSetupForm from '@/components/auth/OwnerSetupForm';
import SignInForm from '@/components/auth/SignInForm';
import { ErrorNotice } from '@/components/auth/AuthFields';
import { DESKTOP_ONLY_MESSAGE } from '@/services/authService';

export default function LoginPage() {
  const { desktopAvailable, needsSetup, sessionError } = useSession();

  if (!desktopAvailable) {
    return (
      <AuthShell title="نظام الحسابات والإدارة المالية" subtitle="لمزرعة المواشي">
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <MonitorX className="h-10 w-10 text-slate-400" />
          <p className="text-sm text-slate-600">{DESKTOP_ONLY_MESSAGE}</p>
        </div>
      </AuthShell>
    );
  }

  if (sessionError) {
    return (
      <AuthShell title="نظام الحسابات والإدارة المالية" subtitle="لمزرعة المواشي">
        <div className="flex flex-col gap-4">
          <ErrorNotice message={sessionError} />
          <p className="text-xs text-slate-500 text-center flex items-center justify-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" />
            أعد تشغيل البرنامج، وإذا تكرر الخطأ تواصل مع الدعم الفني
          </p>
        </div>
      </AuthShell>
    );
  }

  return needsSetup ? <OwnerSetupForm /> : <SignInForm />;
}
