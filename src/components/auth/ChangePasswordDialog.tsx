import { useState, type FormEvent } from 'react';
import { KeyRound, Lock, X, Loader as Loader2 } from 'lucide-react';
import { changePassword } from '@/services/authService';
import { AuthField, ErrorNotice } from '@/components/auth/AuthFields';

const MIN_PASSWORD_LENGTH = 8;

interface ChangePasswordDialogProps {
  onClose: () => void;
}

export default function ChangePasswordDialog({ onClose }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`كلمة المرور الجديدة يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('كلمتا المرور الجديدتان غير متطابقتين');
      return;
    }
    setSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 id="change-password-title" className="text-lg font-semibold text-slate-800">تغيير كلمة المرور</h3>
            <p className="mt-1 text-sm text-slate-500">عند التغيير تُنهى الجلسات المفتوحة على حسابك في الأجهزة الأخرى</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-5">
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">تم تغيير كلمة المرور بنجاح</p>
            <button type="button" onClick={onClose} className="btn-primary w-full py-2.5">تم</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <AuthField label="كلمة المرور الحالية" icon={Lock}>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input-base pr-9"
                autoComplete="current-password"
                required
                autoFocus
              />
            </AuthField>

            <AuthField label="كلمة المرور الجديدة" icon={KeyRound}>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={`${MIN_PASSWORD_LENGTH} أحرف على الأقل`}
                className="input-base pr-9"
                autoComplete="new-password"
                required
              />
            </AuthField>

            <AuthField label="تأكيد كلمة المرور الجديدة" icon={KeyRound}>
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

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5">إلغاء</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1 py-2.5">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{saving ? 'جارٍ الحفظ...' : 'حفظ'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
