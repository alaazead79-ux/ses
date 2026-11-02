import { useState, type FormEvent } from 'react';
import { useSession } from '@/context/SessionContext';
import { Lock, User, Loader as Loader2 } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';
import { AuthField, ErrorNotice } from '@/components/auth/AuthFields';

export default function SignInForm() {
  const { signIn, loading } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    }
  }

  return (
    <AuthShell title="نظام الحسابات والإدارة المالية" subtitle="لمزرعة المواشي — تسجيل الدخول">
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthField label="اسم المستخدم" icon={User}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="أدخل اسم المستخدم"
            className="input-base pr-9"
            autoComplete="username"
            autoFocus
            required
          />
        </AuthField>

        <AuthField label="كلمة المرور" icon={Lock}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="أدخل كلمة المرور"
            className="input-base pr-9"
            autoComplete="current-password"
            required
          />
        </AuthField>

        {error && <ErrorNotice message={error} />}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          <span>{loading ? 'جارٍ التحقق...' : 'تسجيل الدخول'}</span>
        </button>
      </form>
    </AuthShell>
  );
}
