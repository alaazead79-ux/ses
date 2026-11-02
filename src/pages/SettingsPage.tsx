import { useState, useEffect, useCallback } from 'react';
import { Settings, Sprout, Users as UsersIcon, Calendar, Save, Shield, Plus, CreditCard as Edit2, Power, Trash2, X } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { getSettings, updateSettings } from '@/services/settingsService';
import { listActivities, createActivity, updateActivity, deleteActivity, type Activity } from '@/services/activityService';
import { listFiscalPeriods, createFiscalPeriod, closeFiscalPeriod, type FiscalPeriod } from '@/services/fiscalService';
import { listUsers, createUser, updateUser, listAllPermissions, type UserListResult } from '@/services/authService';
import { ROLES, type RoleId } from '@/lib/types';
import { formatShortDate } from '@/lib/format';

type Tab = 'farm' | 'activities' | 'fiscal' | 'users' | 'permissions';

export default function SettingsPage() {
  const { hasPermission } = useSession();
  const [tab, setTab] = useState<Tab>('farm');

  const tabs: { id: Tab; label: string; icon: typeof Settings; perm: string }[] = [
    { id: 'farm', label: 'بيانات المزرعة', icon: Sprout, perm: 'settings.view' },
    { id: 'activities', label: 'الأنشطة', icon: Settings, perm: 'settings.view' },
    { id: 'fiscal', label: 'السنة المالية', icon: Calendar, perm: 'settings.view' },
    { id: 'users', label: 'المستخدمون', icon: UsersIcon, perm: 'users.manage' },
    { id: 'permissions', label: 'الصلاحيات', icon: Shield, perm: 'users.manage' },
  ];
  const visibleTabs = tabs.filter((t) => hasPermission(t.perm));

  return (
    <div>
      <PageHeader title="الإعدادات" subtitle="تخصيص النظام: بيانات المزرعة، الأنشطة، السنة المالية، المستخدمون والصلاحيات" icon={Settings} />
      <div className="flex gap-2 mb-4 border-b border-slate-200 overflow-x-auto">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition whitespace-nowrap
                ${tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'farm' && <FarmSettingsTab />}
      {tab === 'activities' && <ActivitiesTab />}
      {tab === 'fiscal' && <FiscalTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'permissions' && <PermissionsTab />}
    </div>
  );
}

// ===================== بيانات المزرعة =====================
function FarmSettingsTab() {
  const { user } = useSession();
  const [settings, setSettings] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const fields = [
    { key: 'farm_name', label: 'اسم المزرعة', type: 'text' },
    { key: 'farm_phone', label: 'هاتف المزرعة', type: 'text' },
    { key: 'farm_address', label: 'عنوان المزرعة', type: 'text' },
    { key: 'currency', label: 'العملة', type: 'text' },
    { key: 'fiscal_year_start', label: 'بداية السنة المالية (شهر-يوم)', type: 'text' },
    { key: 'system_start_date', label: 'تاريخ بداية استخدام النظام', type: 'date' },
    { key: 'default_cashbox_name', label: 'اسم الخزينة الافتراضية', type: 'text' },
    { key: 'stock_alert_threshold', label: 'حد التنبيه للمخزون', type: 'number' },
  ];

  async function handleSave() {
    setSaving(true);
    try {
      const items = Array.from(settings.entries()).map(([key, value]) => ({ key, value }));
      await updateSettings(items, user?.id ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">{f.label}</label>
            <input
              type={f.type}
              value={settings.get(f.key) ?? ''}
              onChange={(e) => {
                const next = new Map(settings);
                next.set(f.key, e.target.value);
                setSettings(next);
              }}
              className="input-base"
            />
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <Save className="h-4 w-4" />
          <span>{saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</span>
        </button>
        {saved && <Badge tone="emerald" dot>تم الحفظ</Badge>}
      </div>
    </div>
  );
}

// ===================== الأنشطة =====================
function ActivitiesTab() {
  const [items, setItems] = useState<Activity[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Activity | null>(null);

  const load = useCallback(() => listActivities().then(setItems), []);
  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!name.trim()) return;
    await createActivity({ name: name.trim() });
    setName('');
    load();
  }

  async function handleToggle(a: Activity) {
    await updateActivity(a.id, { is_active: !a.is_active });
    load();
  }

  async function handleDelete(a: Activity) {
    if (!confirm(`حذف النشاط "${a.name}"؟ هذا لا يمكن التراجع عنه.`)) return;
    try {
      await deleteActivity(a.id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'خطأ');
    }
  }

  return (
    <div className="card p-6 max-w-2xl">
      <h3 className="font-semibold text-slate-800 mb-4">إدارة الأنشطة</h3>
      <div className="flex gap-2 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم النشاط الجديد" className="input-base flex-1" />
        <button onClick={handleAdd} className="btn-primary"><Plus className="h-4 w-4" /> إضافة</button>
      </div>
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-700">{a.name}</span>
              {a.is_active ? <Badge tone="emerald" dot>نشط</Badge> : <Badge tone="slate" dot>متوقف</Badge>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setEditing(a)} className="btn-ghost p-1.5"><Edit2 className="h-4 w-4" /></button>
              <button onClick={() => handleToggle(a)} className="btn-ghost p-1.5"><Power className="h-4 w-4" /></button>
              <button onClick={() => handleDelete(a)} className="btn-ghost p-1.5 text-rose-500"><Trash2 className="h-4 w-4" /></button>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <EditActivityModal activity={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}

function EditActivityModal({ activity, onClose, onSaved }: { activity: Activity; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(activity.name);
  const [desc, setDesc] = useState(activity.description ?? '');

  async function handleSave() {
    await updateActivity(activity.id, { name, description: desc });
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">تعديل النشاط</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الوصف</label><input value={desc} onChange={(e) => setDesc(e.target.value)} className="input-base" /></div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} className="btn-primary flex-1">حفظ</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ===================== السنة المالية =====================
function FiscalTab() {
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const load = useCallback(() => listFiscalPeriods().then(setPeriods), []);
  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!name.trim() || !start || !end) { alert('يرجى ملء جميع الحقول'); return; }
    try {
      await createFiscalPeriod({ name: name.trim(), startDate: start, endDate: end });
      setName(''); setStart(''); setEnd('');
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'خطأ');
    }
  }

  async function handleClose(p: FiscalPeriod) {
    if (!confirm(`إقفال الفترة "${p.name}"؟ لا يمكن التراجع.`)) return;
    await closeFiscalPeriod(p.id, null);
    load();
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="card p-6">
        <h3 className="font-semibold text-slate-800 mb-4">إنشاء فترة مالية جديدة</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="سنة 2026" className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">تاريخ البداية</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">تاريخ النهاية</label><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-base" /></div>
        </div>
        <button onClick={handleCreate} className="btn-primary mt-4"><Plus className="h-4 w-4" /> إنشاء</button>
      </div>

      <div className="card p-6">
        <h3 className="font-semibold text-slate-800 mb-4">الفترات المالية</h3>
        {periods.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">لا توجد فترات مالية بعد</p>
        ) : (
          <ul className="space-y-2">
            {periods.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <span className="font-semibold text-slate-700">{p.name}</span>
                  <p className="text-xs text-slate-500 num">{formatShortDate(p.start_date)} — {formatShortDate(p.end_date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {p.is_closed ? <Badge tone="slate" dot>مقفلة</Badge> : <Badge tone="emerald" dot>مفتوحة</Badge>}
                  {!p.is_closed && <button onClick={() => handleClose(p)} className="btn-secondary text-xs py-1">إقفال</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ===================== المستخدمون =====================
function UsersTab() {
  const [users, setUsers] = useState<UserListResult[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => listUsers().then(setUsers), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="card p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-800">المستخدمون</h3>
        <button onClick={() => setShowModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> مستخدم جديد</button>
      </div>
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid place-items-center h-9 w-9 rounded-full bg-brand-50 text-brand-600 text-sm font-bold">
                {u.display_name.charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-slate-700">{u.display_name}</p>
                <p className="text-xs text-slate-500 num">@{u.username} — {u.role_label}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {u.is_active ? <Badge tone="emerald" dot>نشط</Badge> : <Badge tone="rose" dot>معطّل</Badge>}
              <button
                onClick={async () => {
                  await updateUser(u.id, { isActive: !u.is_active });
                  load();
                }}
                className="btn-ghost p-1.5"
                title={u.is_active ? 'تعطيل' : 'تفعيل'}
              >
                <Power className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {showModal && <UserModal onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

function UserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState<RoleId>('user');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    if (!username.trim() || !displayName.trim() || !password) { setError('يرجى ملء جميع الحقول'); return; }
    setSaving(true);
    try {
      await createUser({ username: username.trim(), displayName: displayName.trim(), password, roleId, permissions: [] });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">مستخدم جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">اسم المستخدم</label><input value={username} onChange={(e) => setUsername(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاسم المعروض</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">كلمة المرور</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-base" /></div>
          <div>
            <label className="text-sm font-semibold text-slate-700 mb-1 block">الدور</label>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value as RoleId)} className="input-base">
              {ROLES.filter((r) => r.id !== 'owner').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ===================== الصلاحيات =====================
function PermissionsTab() {
  const [perms, setPerms] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => { listAllPermissions().then(setPerms); }, []);

  const grouped = perms.reduce<Record<string, { id: string; label: string }[]>>((acc, p) => {
    const module = p.id.split('.')[0];
    (acc[module] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="card p-6 max-w-3xl">
      <h3 className="font-semibold text-slate-800 mb-2">قائمة الصلاحيات المتاحة</h3>
      <p className="text-sm text-slate-500 mb-4">يحصل المالك على جميع الصلاحيات تلقائيًا. للأدوار الأخرى تُضاف صلاحيات الدور الافتراضية. تُمنح صلاحيات إضافية عند إنشاء/تعديل المستخدم لاحقًا.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Object.entries(grouped).map(([module, list]) => (
          <div key={module} className="rounded-lg border border-slate-200 p-4">
            <p className="font-semibold text-slate-700 mb-2 capitalize">{module}</p>
            <ul className="space-y-1">
              {list.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm text-slate-600">
                  <Shield className="h-3.5 w-3.5 text-slate-400" />
                  {p.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
