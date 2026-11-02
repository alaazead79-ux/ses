import { useState, type FormEvent } from 'react';
import { useSession } from '@/context/SessionContext';
import { KeyRound, Lock, User, CircleUser as UserCircle, Loader as Loader2 } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';
import { AuthField, ErrorNotice } from '@/components/auth/AuthFields';

const MIN_PASSWORD_LENGTH = 8;

export default function OwnerSetupForm() {
  const { setupOwner, loading } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف`);
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }
    try {
      await setupOwner({ username: username.trim(), displayName: displayName.trim(), password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    }
  }

  return (
    <AuthShell title="إعداد حساب المالك" subtitle="أول مرة تُشغّل فيها البرنامج — أنشئ حساب المالك">
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthField label="الاسم الظاهر" icon={UserCircle}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="مثال: أحمد محمد"
            className="input-base pr-9"
            maxLength={80}
            autoFocus
            required
          />
        </AuthField>

        <AuthField label="اسم المستخدم" icon={User}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="حروف إنجليزية وأرقام فقط"
            className="input-base pr-9"
            autoComplete="username"
            maxLength={32}
            required
          />
        </AuthField>

        <AuthField label="كلمة المرور" icon={Lock}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`${MIN_PASSWORD_LENGTH} أحرف على الأقل`}
            className="input-base pr-9"
            autoComplete="new-password"
            required
          />
        </AuthField>

        <AuthField label="تأكيد كلمة المرور" icon={KeyRound}>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input-base pr-9"
            autoComplete="new-password"
            required
          />
        </AuthField>

        {error && <ErrorNotice message={error} />}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          <span>{loading ? 'جارٍ الإنشاء...' : 'إنشاء الحساب والدخول'}</span>
        </button>
      </form>
    </AuthShell>
  );
}
