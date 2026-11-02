import { getDb, toCents } from '@/db/db';
import { createJournalEntry } from './accountingService';

export interface Employee {
  id: string;
  name: string;
  phone: string | null;
  job_title: string | null;
  hire_date: string | null;
  base_salary: number;
  salary_type: string;
  status: string;
  activity_id: string | null;
}

export async function listEmployees(): Promise<Employee[]> {
  const db = await getDb();
  const res = await db.query<Employee>(
    `SELECT id, name, phone, job_title, hire_date::text, base_salary, salary_type, status, activity_id FROM employees ORDER BY name`
  );
  return res.rows;
}

export async function createEmployee(data: {
  name: string; phone?: string; jobTitle?: string; hireDate?: string;
  baseSalary: number; salaryType: string; activityId?: string | null;
}): Promise<Employee> {
  const db = await getDb();
  const res = await db.query<Employee>(
    `INSERT INTO employees (name, phone, job_title, hire_date, base_salary, salary_type, activity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, phone, job_title, hire_date::text, base_salary, salary_type, status, activity_id`,
    [data.name, data.phone ?? null, data.jobTitle ?? null, data.hireDate ?? null,
     toCents(data.baseSalary), data.salaryType, data.activityId ?? null]
  );
  return res.rows[0];
}

export async function updateEmployee(id: string, data: Partial<{
  name: string; phone: string; job_title: string; hire_date: string;
  base_salary: number; salary_type: string; status: string; activity_id: string;
}>): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { values.push(data.name); fields.push(`name = $${values.length}`); }
  if (data.phone !== undefined) { values.push(data.phone); fields.push(`phone = $${values.length}`); }
  if (data.job_title !== undefined) { values.push(data.job_title); fields.push(`job_title = $${values.length}`); }
  if (data.hire_date !== undefined) { values.push(data.hire_date); fields.push(`hire_date = $${values.length}`); }
  if (data.base_salary !== undefined) { values.push(toCents(data.base_salary)); fields.push(`base_salary = $${values.length}`); }
  if (data.salary_type !== undefined) { values.push(data.salary_type); fields.push(`salary_type = $${values.length}`); }
  if (data.status !== undefined) { values.push(data.status); fields.push(`status = $${values.length}`); }
  if (data.activity_id !== undefined) { values.push(data.activity_id); fields.push(`activity_id = $${values.length}`); }
  if (fields.length === 0) return;
  values.push(id);
  await db.query(`UPDATE employees SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
}

export async function deleteEmployee(id: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM employees WHERE id = $1', [id]);
}

export interface Attendance {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  notes: string | null;
}

export async function listAttendance(employeeId?: string, month?: string): Promise<Attendance[]> {
  const db = await getDb();
  let query = `
    SELECT a.id, a.employee_id, e.name as employee_name, a.date::text, a.status,
           a.check_in::text, a.check_out::text, a.notes
    FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE 1=1`;
  const params: unknown[] = [];
  if (employeeId) { params.push(employeeId); query += ` AND a.employee_id = $${params.length}`; }
  if (month) { params.push(month); query += ` AND a.date::text LIKE $${params.length}`; }
  query += ' ORDER BY a.date DESC';
  const res = await db.query<Attendance>(query, params);
  return res.rows;
}

export async function recordAttendance(data: {
  employeeId: string; date: string; status: string; checkIn?: string; checkOut?: string; notes?: string;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO attendance (employee_id, date, status, check_in, check_out, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [data.employeeId, data.date, data.status, data.checkIn ?? null, data.checkOut ?? null, data.notes ?? null]
  );
}

export interface SalaryRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  month: string;
  base_salary: number;
  overtime: number;
  deductions: number;
  advance_deduct: number;
  net_salary: number;
  status: string;
}

export async function listSalaryRecords(month?: string): Promise<SalaryRecord[]> {
  const db = await getDb();
  let query = `
    SELECT s.id, s.employee_id, e.name as employee_name, s.month::text, s.base_salary,
           s.overtime, s.deductions, s.advance_deduct, s.net_salary, s.status
    FROM salary_records s JOIN employees e ON s.employee_id = e.id`;
  const params: unknown[] = [];
  if (month) { params.push(month); query += ` WHERE s.month::text LIKE $${params.length}`; }
  query += ' ORDER BY s.month DESC, e.name';
  const res = await db.query<SalaryRecord>(query, params);
  return res.rows;
}

export async function generatePayroll(data: { month: string; createdBy?: string | null }): Promise<void> {
  const db = await getDb();
  const employees = await db.query<{ id: string; base_salary: number; status: string }>(
    'SELECT id, base_salary, status FROM employees WHERE status = $1', ['active']
  );
  for (const emp of employees.rows) {
    // التحقق من عدم وجود مسير لهذا الشهر
    const exists = await db.query<{ count: number }>(
      'SELECT count(*) as count FROM salary_records WHERE employee_id = $1 AND month::text LIKE $2',
      [emp.id, data.month + '%']
    );
    if (exists.rows[0].count > 0) continue;

    const net = emp.base_salary; // الراتب الأساسي = الصافي مؤقتًا
    await db.query(
      `INSERT INTO salary_records (employee_id, month, base_salary, overtime, deductions, advance_deduct, net_salary, status)
       VALUES ($1, $2, $3, 0, 0, 0, $4, 'pending')`,
      [emp.id, data.month, emp.base_salary, net]
    );
  }
}

export async function paySalary(id: string, createdBy?: string | null): Promise<void> {
  const db = await getDb();
  const record = await db.query<{ employee_id: string; net_salary: number }>(
    'SELECT employee_id, net_salary FROM salary_records WHERE id = $1', [id]
  );
  if (record.rows.length === 0) throw new Error('السجل غير موجود');
  const r = record.rows[0];

  // قيد صرف الراتب: مدين الرواتب، دائن الخزينة
  await createJournalEntry({
    date: new Date().toISOString().slice(0, 10),
    description: `صرف راتب ${r.net_salary / 100} ج.م`,
    referenceType: 'salary',
    lines: [
      { accountId: 'acc_salaries', debit: r.net_salary / 100, credit: 0 },
      { accountId: 'acc_cash', debit: 0, credit: r.net_salary / 100 },
    ],
    createdBy,
  });

  await db.query("UPDATE salary_records SET status = 'paid', paid_at = now() WHERE id = $1", [id]);
}

export interface EmployeeAdvance {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  amount: number;
  repayment_method: string;
  installment_amount: number;
  total_paid: number;
  remaining: number;
  status: string;
}

export async function listAdvances(): Promise<EmployeeAdvance[]> {
  const db = await getDb();
  const res = await db.query<EmployeeAdvance>(
    `SELECT a.id, a.employee_id, e.name as employee_name, a.date::text, a.amount,
            a.repayment_method, a.installment_amount, a.total_paid, a.remaining, a.status
     FROM employee_advances a JOIN employees e ON a.employee_id = e.id ORDER BY a.date DESC`
  );
  return res.rows;
}

export async function createAdvance(data: {
  employeeId: string; date: string; amount: number; repaymentMethod?: string; installmentAmount?: number; createdBy?: string | null;
}): Promise<void> {
  if (data.amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  const db = await getDb();

  // قيد السلفة: مدين سلف الموظفين، دائن الخزينة
  await createJournalEntry({
    date: data.date,
    description: `سلفة موظف`,
    referenceType: 'advance',
    lines: [
      { accountId: 'acc_advances_emp', debit: data.amount, credit: 0 },
      { accountId: 'acc_cash', debit: 0, credit: data.amount },
    ],
    createdBy: data.createdBy,
  });

  await db.query(
    `INSERT INTO employee_advances (employee_id, date, amount, repayment_method, installment_amount, total_paid, remaining, status)
     VALUES ($1, $2, $3, $4, $5, 0, $3, 'active')`,
    [data.employeeId, data.date, toCents(data.amount), data.repaymentMethod ?? 'installment', toCents(data.installmentAmount ?? 0)]
  );
}
