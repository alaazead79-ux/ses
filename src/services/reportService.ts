import { getDb } from '@/db/db';

export interface DashboardStats {
  totalRevenues: number;
  totalExpenses: number;
  netProfit: number;
  cashBalance: number;
  totalReceivables: number;
  totalPayables: number;
  totalPurchases: number;
  totalSales: number;
  inventoryValue: number;
  salariesDue: number;
  advancesDue: number;
  checksDue: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = await getDb();

  const cashRes = await db.query<{ balance: number }>('SELECT COALESCE(SUM(balance), 0) as balance FROM cashboxes WHERE is_active = true');
  const arRes = await db.query<{ balance: number }>(
    `SELECT COALESCE(SUM(p.opening_balance + (COALESCE((SELECT SUM(pt.debit - pt.credit) FROM party_transactions pt WHERE pt.party_id = p.id), 0))), 0) as balance
     FROM parties p WHERE p.type IN ('customer', 'both')`
  );
  const apRes = await db.query<{ balance: number }>(
    `SELECT COALESCE(SUM(p.opening_balance + (COALESCE((SELECT SUM(pt.credit - pt.debit) FROM party_transactions pt WHERE pt.party_id = p.id), 0))), 0) as balance
     FROM parties p WHERE p.type IN ('supplier', 'both')`
  );
  const salesRes = await db.query<{ total: number }>(`SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE doc_type = 'sales' AND status = 'posted'`);
  const purchaseRes = await db.query<{ total: number }>(`SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE doc_type = 'purchase' AND status = 'posted'`);
  const invRes = await db.query<{ value: number }>(`SELECT COALESCE(SUM(quantity * avg_cost), 0) as value FROM products WHERE is_active = true`);
  const salRes = await db.query<{ total: number }>(`SELECT COALESCE(SUM(net_salary), 0) as total FROM salary_records WHERE status = 'pending'`);
  const advRes = await db.query<{ total: number }>(`SELECT COALESCE(SUM(remaining), 0) as total FROM employee_advances WHERE status = 'active'`);
  const chkRes = await db.query<{ total: number }>(`SELECT COALESCE(SUM(amount), 0) as total FROM checks WHERE status IN ('received', 'issued', 'due')`);

  // الإيرادات والمصروفات من أرصدة الحسابات
  const revRes = await db.query<{ balance: number }>(`SELECT COALESCE(SUM(-balance), 0) as balance FROM accounts WHERE type = 'revenue'`);
  const expRes = await db.query<{ balance: number }>(`SELECT COALESCE(SUM(balance), 0) as balance FROM accounts WHERE type = 'expense'`);

  return {
    totalRevenues: revRes.rows[0].balance / 100,
    totalExpenses: expRes.rows[0].balance / 100,
    netProfit: (revRes.rows[0].balance - expRes.rows[0].balance) / 100,
    cashBalance: cashRes.rows[0].balance / 100,
    totalReceivables: Math.max(0, arRes.rows[0].balance / 100),
    totalPayables: Math.max(0, apRes.rows[0].balance / 100),
    totalPurchases: purchaseRes.rows[0].total / 100,
    totalSales: salesRes.rows[0].total / 100,
    inventoryValue: invRes.rows[0].value / 100,
    salariesDue: salRes.rows[0].total / 100,
    advancesDue: advRes.rows[0].total / 100,
    checksDue: chkRes.rows[0].total / 100,
  };
}

export interface ProfitLossReport {
  revenues: { account: string; amount: number }[];
  expenses: { account: string; amount: number }[];
  totalRevenues: number;
  totalExpenses: number;
  netProfit: number;
}

export async function getProfitLoss(activityId?: string | null, dateFrom?: string, dateTo?: string): Promise<ProfitLossReport> {
  const db = await getDb();

  let activityCond = '';
  const params: unknown[] = [];
  if (activityId) { params.push(activityId); activityCond = ` AND e.activity_id = $${params.length}`; }
  let dateCond = '';
  if (dateFrom) { params.push(dateFrom); dateCond += ` AND e.date >= $${params.length}`; }
  if (dateTo) { params.push(dateTo); dateCond += ` AND e.date <= $${params.length}`; }

  const revRes = await db.query<{ name: string; amount: number }>(
    `SELECT a.name, COALESCE(SUM(-l.credit + l.debit), 0) as amount
     FROM journal_lines l JOIN journal_entries e ON l.entry_id = e.id JOIN accounts a ON l.account_id = a.id
     WHERE a.type = 'revenue' AND e.status = 'posted'${activityCond}${dateCond}
     GROUP BY a.name ORDER BY a.name`, params
  );
  const expRes = await db.query<{ name: string; amount: number }>(
    `SELECT a.name, COALESCE(SUM(l.debit - l.credit), 0) as amount
     FROM journal_lines l JOIN journal_entries e ON l.entry_id = e.id JOIN accounts a ON l.account_id = a.id
     WHERE a.type = 'expense' AND e.status = 'posted'${activityCond}${dateCond}
     GROUP BY a.name ORDER BY a.name`, params
  );

  const revenues = revRes.rows.map((r) => ({ account: r.name, amount: r.amount / 100 }));
  const expenses = expRes.rows.map((r) => ({ account: r.name, amount: r.amount / 100 }));
  const totalRevenues = revenues.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

  return { revenues, expenses, totalRevenues, totalExpenses, netProfit: totalRevenues - totalExpenses };
}

export interface ActivitySummary {
  activity_id: string;
  activity_name: string;
  revenues: number;
  expenses: number;
  profit: number;
}

export async function getActivitySummaries(dateFrom?: string, dateTo?: string): Promise<ActivitySummary[]> {
  const db = await getDb();
  let dateCond = '';
  const params: unknown[] = [];
  if (dateFrom) { params.push(dateFrom); dateCond += ` AND e.date >= $${params.length}`; }
  if (dateTo) { params.push(dateTo); dateCond += ` AND e.date <= $${params.length}`; }

  const res = await db.query<{ activity_id: string; activity_name: string; revenues: number; expenses: number }>(
    `SELECT act.id as activity_id, act.name as activity_name,
       COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN -l.credit + l.debit ELSE 0 END), 0) as revenues,
       COALESCE(SUM(CASE WHEN a.type = 'expense' THEN l.debit - l.credit ELSE 0 END), 0) as expenses
     FROM activities act
     LEFT JOIN journal_entries e ON e.activity_id = act.id AND e.status = 'posted'${dateCond}
     LEFT JOIN journal_lines l ON l.entry_id = e.id
     LEFT JOIN accounts a ON l.account_id = a.id
     GROUP BY act.id, act.name ORDER BY act.sort_order`, params
  );

  return res.rows.map((r) => ({
    activity_id: r.activity_id, activity_name: r.activity_name,
    revenues: r.revenues / 100, expenses: r.expenses / 100, profit: (r.revenues - r.expenses) / 100,
  }));
}
