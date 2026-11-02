import type { ReactNode } from 'react';
import { Search, ArrowUpDown, Inbox } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  searchable?: boolean;
}

export default function DataTable<T extends { id: string | number }>({
  columns,
  rows,
  emptyTitle = 'لا توجد بيانات',
  emptyDescription = 'لم يتم تسجيل أي سجلات بعد.',
  emptyAction,
  searchable = true,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="card overflow-hidden">
        {searchable && (
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="relative max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input disabled placeholder="بحث..." className="input-base pr-9 opacity-60" />
            </div>
          </div>
        )}
        <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
          <div className="rounded-2xl bg-slate-50 p-5 text-slate-300">
            <Inbox className="h-12 w-12" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-700">{emptyTitle}</h3>
          <p className="mt-1.5 text-sm text-slate-500 max-w-md">{emptyDescription}</p>
          {emptyAction && <div className="mt-5">{emptyAction}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {searchable && (
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="relative max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input placeholder="بحث..." className="input-base pr-9" />
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${col.className ?? ''}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition"
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-slate-700 ${col.className ?? ''}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
