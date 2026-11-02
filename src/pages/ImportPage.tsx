import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { useSession } from '@/context/SessionContext';
import { getDb } from '@/db/db';

type Step = 'select' | 'preview' | 'done';
const DATA_TYPES = [
  { value: 'parties', label: 'عملاء وموردون' },
  { value: 'products', label: 'أصناف' },
  { value: 'employees', label: 'موظفون' },
];

export default function ImportPage() {
  const { hasPermission } = useSession();
  const [step, setStep] = useState<Step>('select');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataType, setDataType] = useState('parties');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function parseCSV(text: string): string[][] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    return lines.map((line) => {
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
        current += ch;
      }
      cells.push(current.trim());
      return cells;
    });
  }

  function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (file.name.endsWith('.csv')) {
        const parsed = parseCSV(text);
        if (parsed.length < 2) { setError('الملف لا يحتوي على بيانات كافية'); return; }
        setHeaders(parsed[0]);
        setRows(parsed.slice(1));
        setStep('preview');
      } else {
        setError('يدعم البرنامج حاليًا ملفات CSV. صيغ XLSX و PDF ستُضاف لاحقًا.');
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  async function handleImport() {
    setImporting(true); setError(null);
    try {
      const db = await getDb();
      let count = 0;
      if (dataType === 'parties') {
        for (const row of rows) {
          if (row.length < 2 || !row[0]?.trim()) continue;
          await db.query(
            `INSERT INTO parties (name, type, phone) VALUES ($1, 'customer', $2) ON CONFLICT DO NOTHING`,
            [row[0].trim(), row[1]?.trim() || null]
          );
          count++;
        }
      } else if (dataType === 'products') {
        for (const row of rows) {
          if (row.length < 2 || !row[0]?.trim()) continue;
          await db.query(
            `INSERT INTO products (name, category, unit) VALUES ($1, 'supplies', $2)`,
            [row[0].trim(), row[1]?.trim() || 'قطعة']
          );
          count++;
        }
      } else if (dataType === 'employees') {
        for (const row of rows) {
          if (row.length < 1 || !row[0]?.trim()) continue;
          await db.query(
            `INSERT INTO employees (name, salary_type, base_salary) VALUES ($1, 'monthly', 0)`,
            [row[0].trim()]
          );
          count++;
        }
      }
      setImportedCount(count);
      setStep('done');
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setImporting(false); }
  }

  function reset() {
    setStep('select'); setFileName(''); setRows([]); setHeaders([]); setError(null); setImportedCount(0);
  }

  return (
    <div>
      <PageHeader title="استيراد البيانات القديمة" subtitle="معاينة وتحقق قبل الحفظ — يدعم CSV" icon={Upload} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <h3 className="font-semibold text-slate-800 mb-3">خطوات الاستيراد</h3>
          <ol className="space-y-2">
            {['اختيار ملف CSV', 'معاينة البيانات', 'تحديد نوع البيانات', 'التأكيد والاستيراد', 'سجل بالنتائج'].map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`shrink-0 grid place-items-center h-6 w-6 rounded-full text-xs font-bold num
                  ${step === 'select' && i === 0 ? 'bg-brand-600 text-white' : step === 'preview' && i <= 2 ? 'bg-brand-600 text-white' : step === 'done' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                <span className="text-sm text-slate-600">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="card lg:col-span-2">
          {step === 'select' && (
            <EmptyState icon={FileSpreadsheet} title="اختر ملفًا للاستيراد" description="يدعم البرنامج ملفات CSV. صيغ Excel و PDF ستُضاف لاحقًا."
              action={hasPermission('import.run') ? <button onClick={() => fileRef.current?.click()} className="btn-primary"><Upload className="h-4 w-4" /> اختيار ملف</button> : undefined} />
          )}
          {step === 'preview' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div><p className="font-semibold text-slate-800">{fileName}</p><p className="text-xs text-slate-500 num">{rows.length} سجل</p></div>
                <button onClick={reset} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
              </div>
              <div className="mb-4"><label className="text-sm font-semibold text-slate-700 mb-1 block">نوع البيانات</label>
                <select value={dataType} onChange={(e) => setDataType(e.target.value)} className="input-base">
                  {DATA_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select></div>
              <div className="overflow-x-auto max-h-64 border border-slate-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 sticky top-0">
                    {headers.map((h, i) => <th key={i} className="px-3 py-2 text-right font-semibold text-slate-500">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, 20).map((row, i) => (
                      <tr key={i} className="border-b border-slate-50 last:border-0">
                        {row.map((cell, j) => <td key={j} className="px-3 py-2 text-slate-600">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 20 && <p className="text-xs text-slate-400 mt-2">عرض أول 20 سجل من {rows.length}</p>}
              {error && <div className="flex items-center gap-2 text-sm text-rose-600 mt-3"><AlertCircle className="h-4 w-4" />{error}</div>}
              <div className="flex gap-2 mt-4">
                <button onClick={handleImport} disabled={importing} className="btn-primary flex-1"><ArrowRight className="h-4 w-4" /> {importing ? 'جارٍ الاستيراد...' : 'تأكيد الاستيراد'}</button>
                <button onClick={reset} className="btn-secondary">إلغاء</button>
              </div>
            </div>
          )}
          {step === 'done' && (
            <div className="p-6">
              <div className="flex flex-col items-center text-center py-8">
                <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" />
                <h3 className="font-bold text-slate-800">تم الاستيراد بنجاح</h3>
                <p className="text-sm text-slate-500 mt-1">تم استيراد {importedCount} سجل إلى {DATA_TYPES.find((d) => d.value === dataType)?.label}</p>
                {error && <div className="flex items-center gap-2 text-sm text-rose-600 mt-2"><AlertCircle className="h-4 w-4" />{error}</div>}
                <button onClick={reset} className="btn-primary mt-5">استيراد ملف آخر</button>
              </div>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      </div>
    </div>
  );
}
