import { useState, useEffect, useCallback } from 'react';
import { Boxes, Plus, X, AlertCircle, ArrowDownCircle, ArrowUpCircle, AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { useSession } from '@/context/SessionContext';
import { formatEGP } from '@/lib/format';
import { listProducts, createProduct, recordStockMovement, listStockMovements, getCategoryLabel, type Product, type StockMovement } from '@/services/inventoryService';
import { listActivities, type Activity } from '@/services/activityService';

export default function InventoryPage() {
  const { hasPermission } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementType, setMovementType] = useState<'in' | 'out'>('in');

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([listProducts(), listStockMovements()]);
    setProducts(p); setMovements(m);
  }, []);
  useEffect(() => { load(); }, [load]);

  const lowStock = products.filter((p) => p.quantity <= p.reorder_level);
  const totalValue = products.reduce((s, p) => s + (p.quantity * p.avg_cost / 100), 0);

  return (
    <div>
      <PageHeader title="المخازن" subtitle="أعلاف، مستلزمات، أدوية، قطع غيار — متوسط التكلفة المرجح" icon={Boxes}
        actions={hasPermission('inventory.add') ? (
          <>
            <button onClick={() => { setMovementType('in'); setShowMovementModal(true); }} className="btn-secondary"><ArrowDownCircle className="h-4 w-4" /> وارد</button>
            <button onClick={() => { setMovementType('out'); setShowMovementModal(true); }} className="btn-secondary"><ArrowUpCircle className="h-4 w-4" /> صادر</button>
            <button onClick={() => setShowProductModal(true)} className="btn-primary"><Plus className="h-4 w-4" /> صنف جديد</button>
          </>
        ) : undefined}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatBox label="قيمة المخزون" value={formatEGP(totalValue)} tone="text-blue-600" />
        <StatBox label="أصناف منخفضة" value={lowStock.length.toString()} tone="text-amber-600" />
        <StatBox label="عدد الأصناف" value={products.length.toString()} tone="text-slate-600" />
        <StatBox label="حركات اليوم" value={movements.filter((m) => m.date === new Date().toISOString().slice(0, 10)).length.toString()} tone="text-slate-600" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100"><h3 className="font-semibold text-slate-800">الأصناف</h3></div>
          {products.length === 0 ? (
            <EmptyState icon={Boxes} title="لا توجد أصناف" description="يُخزَّن هنا الأعلاف والمستلزمات والأدوية وقطع الغيار فقط." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                  <th className="px-4 py-2 text-right font-semibold">الصنف</th>
                  <th className="px-4 py-2 text-right font-semibold">الفئة</th>
                  <th className="px-4 py-2 text-right font-semibold">الكمية</th>
                  <th className="px-4 py-2 text-right font-semibold">التكلفة</th>
                  <th className="px-4 py-2 text-right font-semibold">الحالة</th>
                </tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-2 text-slate-700 font-semibold">{p.name}</td>
                      <td className="px-4 py-2"><Badge tone="slate">{getCategoryLabel(p.category)}</Badge></td>
                      <td className="px-4 py-2 num text-slate-600">{p.quantity} {p.unit}</td>
                      <td className="px-4 py-2 num text-slate-600">{formatEGP(p.avg_cost / 100)}</td>
                      <td className="px-4 py-2">
                        {p.quantity <= p.reorder_level
                          ? <span className="inline-flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3 w-3" /> منخفض</span>
                          : <Badge tone="emerald" dot>متوفر</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100"><h3 className="font-semibold text-slate-800">حركة المخزون</h3></div>
          {movements.length === 0 ? (
            <EmptyState icon={Boxes} title="لا توجد حركات" description="تظهر هنا حركات الوارد والصادر." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                  <th className="px-4 py-2 text-right font-semibold">التاريخ</th>
                  <th className="px-4 py-2 text-right font-semibold">الصنف</th>
                  <th className="px-4 py-2 text-right font-semibold">النوع</th>
                  <th className="px-4 py-2 text-right font-semibold">الكمية</th>
                </tr></thead>
                <tbody>
                  {movements.slice(0, 20).map((m) => (
                    <tr key={m.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 num text-slate-600">{m.date}</td>
                      <td className="px-4 py-2 text-slate-700">{m.product_name}</td>
                      <td className="px-4 py-2"><Badge tone={m.direction === 'in' ? 'emerald' : 'rose'}>{m.direction === 'in' ? 'وارد' : 'صادر'}</Badge></td>
                      <td className="px-4 py-2 num text-slate-600">{m.direction === 'in' ? '+' : '−'}{m.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {showProductModal && <ProductModal onClose={() => setShowProductModal(false)} onSaved={load} />}
      {showMovementModal && <MovementModal type={movementType} products={products} activities={[]} onClose={() => setShowMovementModal(false)} onSaved={load} />}
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold num ${tone}`}>{value}</p>
    </div>
  );
}

function ProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('supplies');
  const [unit, setUnit] = useState('قطعة');
  const [reorderLevel, setReorderLevel] = useState('5');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!name.trim()) { setError('اسم الصنف مطلوب'); return; }
    try {
      await createProduct({ name: name.trim(), category, unit, reorderLevel: parseFloat(reorderLevel) || 0 });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">صنف جديد</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} className="input-base" /></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الفئة</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-base">
              <option value="feed">أعلاف</option><option value="supplies">مستلزمات</option>
              <option value="medication">أدوية</option><option value="spare_parts">قطع غيار</option>
              <option value="other">أخرى</option>
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الوحدة</label><input value={unit} onChange={(e) => setUnit(e.target.value)} className="input-base" /></div>
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">حد إعادة الطلب</label><input type="number" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="input-base num" /></div>
          </div>
          {error && <div className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle className="h-4 w-4" />{error}</div>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} className="btn-primary flex-1">حفظ</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function MovementModal({ type, products, onClose, onSaved }: { type: 'in' | 'out'; products: Product[]; activities: Activity[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const [productId, setProductId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [activityId, setActivityId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);

  useEffect(() => { listActivities().then(setActs); }, []);

  async function handleSave() {
    setError(null);
    if (!productId) { setError('اختر الصنف'); return; }
    const qty = parseFloat(quantity);
    const cost = parseFloat(unitCost) || 0;
    if (!qty || qty <= 0) { setError('أدخل كمية صحيحة'); return; }
    try {
      await recordStockMovement({
        date, productId, type: type === 'in' ? 'purchase' : 'issue', direction: type,
        quantity: qty, unitCost: cost, activityId: activityId || null, createdBy: user?.id ?? null,
      });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">{type === 'in' ? 'حركة وارد' : 'حركة صادر'}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الصنف</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input-base">
              <option value="">اختر</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity} {p.unit})</option>)}
            </select></div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">التاريخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">الكمية</label><input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="input-base num" /></div>
            <div><label className="text-sm font-semibold text-slate-700 mb-1 block">تكلفة الوحدة {type === 'out' ? '(اختياري)' : ''}</label><input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="input-base num" disabled={type === 'out'} /></div>
          </div>
          <div><label className="text-sm font-semibold text-slate-700 mb-1 block">النشاط</label>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="input-base">
              <option value="">— عام —</option>
              {acts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          {error && <div className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle className="h-4 w-4" />{error}</div>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} className="btn-primary flex-1">حفظ</button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
