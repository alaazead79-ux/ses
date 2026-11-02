const crypto = require('crypto');
const { UserFacingError } = require('../errors');
const { audit } = require('../domain/audit');
const { assertIsoDate, requireText, optionalText, toPiastres } = require('../domain/money');
const { nextDocNumber, postJournalEntry } = require('../domain/postingEngine');
const { requireActiveCashbox, cashboxBalance, insertCashTransaction } = require('./treasuryService');

const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave', 'holiday'];
const PAYING_ATTENDANCE = ['present', 'late'];
const SALARY_TYPES = ['monthly', 'daily'];

function assertMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) throw new UserFacingError('الشهر يجب أن يكون بصيغة YYYY-MM');
  const month = Number(value.slice(5));
  if (month < 1 || month > 12) throw new UserFacingError('الشهر غير صالح');
  return value;
}

function requireEmployee(db, employeeId) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(String(employeeId ?? ''));
  if (!employee) throw new UserFacingError('الموظف غير موجود');
  return employee;
}

function listEmployees(db) {
  return db.prepare(`
    SELECT e.id, e.name, e.phone, e.job_title, e.base_salary, e.salary_type, e.status, a.name AS activity_name
    FROM employees e LEFT JOIN activities a ON a.id = e.activity_id
    ORDER BY e.status, e.name
  `).all();
}

function createEmployee(db, userId, input) {
  const name = requireText(input?.name, 'اسم الموظف', 100);
  const salaryType = input?.salaryType ?? 'monthly';
  if (!SALARY_TYPES.includes(salaryType)) throw new UserFacingError('نوع الأجر غير مدعوم (شهري أو يومي)');
  const baseSalary = toPiastres(input?.baseSalary ?? 0, 'الأجر', { allowZero: true });
  const hireDate = input?.hireDate ? assertIsoDate(input.hireDate, 'تاريخ التعيين') : null;
  const activityId = input?.activityId ? String(input.activityId) : null;
  if (activityId && !db.prepare('SELECT id FROM activities WHERE id = ?').get(activityId)) {
    throw new UserFacingError('النشاط غير موجود');
  }
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO employees (id, name, phone, job_title, hire_date, base_salary, salary_type, activity_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, optionalText(input?.phone, 30), optionalText(input?.jobTitle, 80), hireDate, baseSalary,
    salaryType, activityId, optionalText(input?.notes, 300));
  audit(db, { userId, action: 'create', module: 'employees', entityId: id, entityType: 'employee', details: { name } });
  return { id };
}

// الحضور فريد لكل موظف ويوم، وتعديله لا يُرحَّل إلى الحسابات
function recordAttendance(db, userId, input) {
  const employee = requireEmployee(db, input?.employeeId);
  const date = assertIsoDate(input?.date);
  const status = input?.status;
  if (!ATTENDANCE_STATUSES.includes(status)) throw new UserFacingError('حالة الحضور غير صالحة');
  db.prepare(`
    INSERT INTO attendance (id, employee_id, date, status, check_in, check_out, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (employee_id, date) DO UPDATE SET
      status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out, notes = excluded.notes
  `).run(crypto.randomUUID(), employee.id, date, status,
    optionalText(input?.checkIn, 10), optionalText(input?.checkOut, 10), optionalText(input?.notes, 200));
  audit(db, { userId, action: 'upsert', module: 'employees', entityId: employee.id, entityType: 'attendance', details: { date, status } });
}

function listAttendance(db, { month }) {
  return db.prepare(`
    SELECT a.date, a.status, a.check_in, a.check_out, a.notes, e.name AS employee_name, a.employee_id
    FROM attendance a JOIN employees e ON e.id = a.employee_id
    WHERE substr(a.date, 1, 7) = ? ORDER BY a.date, e.name
  `).all(assertMonth(month));
}

// السلفة: مدين سلف الموظفين / دائن الخزينة
function createAdvance(db, userId, input) {
  const employee = requireEmployee(db, input?.employeeId);
  const date = assertIsoDate(input?.date);
  const amount = toPiastres(input?.amount, 'مبلغ السلفة');
  const box = requireActiveCashbox(db, input?.cashboxId);
  return db.transaction(() => {
    if (cashboxBalance(db, box.id) < amount) throw new UserFacingError('رصيد الخزينة غير كافٍ لصرف السلفة');
    const id = crypto.randomUUID();
    const docNumber = nextDocNumber(db, 'advance');
    const description = `سلفة ${employee.name}`;
    const journalEntryId = postJournalEntry(db, {
      date,
      description,
      referenceType: 'advance',
      referenceId: id,
      userId,
      lines: [
        { accountId: 'acc_advances_emp', debit: amount, description },
        { accountId: box.account_id, credit: amount, description },
      ],
    }).id;
    db.prepare(`
      INSERT INTO employee_advances (id, doc_number, employee_id, date, amount, repayment_method,
        installment_amount, total_paid, remaining, status, journal_entry_id)
      VALUES (?, ?, ?, ?, ?, 'deduct_monthly', ?, 0, ?, 'active', ?)
    `).run(id, docNumber, employee.id, date, amount, toPiastres(input?.installmentAmount ?? 0, 'القسط', { allowZero: true }) || amount, amount, journalEntryId);
    insertCashTransaction(db, {
      docNumber, date, type: 'payment', direction: 'out', cashboxId: box.id, amount,
      sourceType: 'advance', sourceId: id, description, journalEntryId, userId,
    });
    audit(db, { userId, action: 'create', module: 'employees', entityId: id, entityType: 'advance', details: { docNumber, amount } });
    return { id, docNumber };
  })();
}

function listAdvances(db, { employeeId = null } = {}) {
  return db.prepare(`
    SELECT a.id, a.doc_number, a.date, a.amount, a.total_paid, a.remaining, a.status, e.name AS employee_name
    FROM employee_advances a JOIN employees e ON e.id = a.employee_id
    WHERE (? IS NULL OR a.employee_id = ?) ORDER BY a.date, a.doc_number
  `).all(employeeId, employeeId);
}

// الراتب الشهري: الأجر الأساسي أو الأجر اليومي × أيام الحضور، مع الإضافي والخصومات
// وتُخصم أقساط السلف النشطة بحد أقصى ما يبقى من الراتب بعد الخصومات
function createSalary(db, userId, input) {
  const employee = requireEmployee(db, input?.employeeId);
  const month = assertMonth(input?.month);
  const date = assertIsoDate(input?.date);
  const overtime = toPiastres(input?.overtime ?? 0, 'الإضافي', { allowZero: true });
  const deductions = toPiastres(input?.deductions ?? 0, 'الخصومات', { allowZero: true });
  const box = input?.cashboxId ? requireActiveCashbox(db, input.cashboxId) : null;
  if (!SALARY_TYPES.includes(employee.salary_type)) throw new UserFacingError('هذا النوع من الأجور غير مدعوم حاليًا');
  if (db.prepare('SELECT id FROM salary_records WHERE employee_id = ? AND month = ?').get(employee.id, month)) {
    throw new UserFacingError('تم إنشاء راتب هذا الموظف لهذا الشهر من قبل');
  }

  const paidDays = employee.salary_type === 'daily'
    ? db.prepare(`SELECT COUNT(*) AS c FROM attendance WHERE employee_id = ? AND substr(date, 1, 7) = ? AND status IN ('present','late')`)
      .get(employee.id, month).c
    : null;
  const base = employee.salary_type === 'daily' ? employee.base_salary * paidDays : employee.base_salary;
  const gross = base + overtime;
  if (gross <= 0) throw new UserFacingError('لا يوجد استحقاق لهذا الشهر');
  if (deductions > gross) throw new UserFacingError('الخصومات أكبر من الاستحقاق');

  return db.transaction(() => {
    let budget = gross - deductions;
    const dueAdvances = db.prepare(`
      SELECT id, doc_number, remaining, installment_amount FROM employee_advances
      WHERE employee_id = ? AND status = 'active' ORDER BY date, doc_number
    `).all(employee.id);
    const advanceTakes = [];
    for (const advance of dueAdvances) {
      if (budget <= 0) break;
      const due = Math.min(advance.remaining, advance.installment_amount || advance.remaining);
      const take = Math.min(due, budget);
      if (take > 0) advanceTakes.push({ ...advance, take });
      budget -= take;
    }
    const advanceDeduct = advanceTakes.reduce((sum, row) => sum + row.take, 0);
    const net = gross - deductions - advanceDeduct;
    const id = crypto.randomUUID();
    const docNumber = nextDocNumber(db, 'salary');
    const description = `راتب ${employee.name} ${month}`;
    const paidNow = box !== null;
    if (paidNow && cashboxBalance(db, box.id) < net) throw new UserFacingError('رصيد الخزينة غير كافٍ لصرف الراتب');

    const expenseAmount = gross - deductions;
    const lines = [{ accountId: 'acc_salaries', debit: expenseAmount, description }];
    if (advanceDeduct > 0) lines.push({ accountId: 'acc_advances_emp', credit: advanceDeduct, description });
    if (net > 0) lines.push({ accountId: paidNow ? box.account_id : 'acc_salaries_pay', credit: net, description });
    const journalEntryId = postJournalEntry(db, { date, description, referenceType: 'salary', referenceId: id, userId, lines }).id;

    db.prepare(`
      INSERT INTO salary_records (id, doc_number, employee_id, month, base_salary, overtime, deductions,
        advance_deduct, net_salary, status, paid_at, journal_entry_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, docNumber, employee.id, month, base, overtime, deductions, advanceDeduct, net,
      paidNow ? 'paid' : 'pending', paidNow ? date : null, journalEntryId);
    const items = db.prepare('INSERT INTO salary_items (id, salary_id, kind, label, amount) VALUES (?, ?, ?, ?, ?)');
    items.run(crypto.randomUUID(), id, 'earning', employee.salary_type === 'daily' ? `أجر ${paidDays} يوم` : 'الأجر الأساسي', base);
    if (overtime > 0) items.run(crypto.randomUUID(), id, 'overtime', 'إضافي', overtime);
    if (deductions > 0) items.run(crypto.randomUUID(), id, 'deduction', 'خصومات', deductions);
    for (const take of advanceTakes) {
      items.run(crypto.randomUUID(), id, 'advance', `قسط سلفة ${take.doc_number}`, take.take);
      const remaining = take.remaining - take.take;
      db.prepare(`
        UPDATE employee_advances
        SET total_paid = total_paid + ?, remaining = ?, status = CASE WHEN ? = 0 THEN 'settled' ELSE 'active' END
        WHERE id = (SELECT id FROM employee_advances WHERE doc_number = ?)
      `).run(take.take, remaining, remaining, take.doc_number);
    }
    if (paidNow && net > 0) {
      insertCashTransaction(db, {
        docNumber, date, type: 'payment', direction: 'out', cashboxId: box.id, amount: net,
        sourceType: 'salary', sourceId: id, description, journalEntryId, userId,
      });
    }
    audit(db, { userId, action: 'create', module: 'employees', entityId: id, entityType: 'salary', details: { docNumber, net } });
    return { id, docNumber, net, advanceDeduct };
  })();
}

// صرف راتب مستحق: مدين الرواتب المستحقة / دائن الخزينة
function paySalary(db, userId, input) {
  const salary = db.prepare('SELECT * FROM salary_records WHERE id = ?').get(String(input?.salaryId ?? ''));
  if (!salary) throw new UserFacingError('الراتب غير موجود');
  if (salary.status !== 'pending') throw new UserFacingError('تم صرف هذا الراتب من قبل');
  const date = assertIsoDate(input?.date);
  const box = requireActiveCashbox(db, input?.cashboxId);
  const employee = requireEmployee(db, salary.employee_id);
  return db.transaction(() => {
    if (cashboxBalance(db, box.id) < salary.net_salary) throw new UserFacingError('رصيد الخزينة غير كافٍ لصرف الراتب');
    const docNumber = nextDocNumber(db, 'payment');
    const description = `صرف راتب ${employee.name} ${salary.month}`;
    const journalEntryId = postJournalEntry(db, {
      date,
      description,
      referenceType: 'salary_payment',
      referenceId: salary.id,
      userId,
      lines: [
        { accountId: 'acc_salaries_pay', debit: salary.net_salary, description },
        { accountId: box.account_id, credit: salary.net_salary, description },
      ],
    }).id;
    insertCashTransaction(db, {
      docNumber, date, type: 'payment', direction: 'out', cashboxId: box.id, amount: salary.net_salary,
      sourceType: 'salary', sourceId: salary.id, description, journalEntryId, userId,
    });
    db.prepare(`UPDATE salary_records SET status = 'paid', paid_at = ? WHERE id = ?`).run(date, salary.id);
    audit(db, { userId, action: 'pay', module: 'employees', entityId: salary.id, entityType: 'salary', details: { amount: salary.net_salary } });
    return { id: salary.id };
  })();
}

function listSalaries(db, { month }) {
  return db.prepare(`
    SELECT s.id, s.doc_number, s.month, s.base_salary, s.overtime, s.deductions, s.advance_deduct,
      s.net_salary, s.status, s.paid_at, e.name AS employee_name
    FROM salary_records s JOIN employees e ON e.id = s.employee_id
    WHERE s.month = ? ORDER BY e.name
  `).all(assertMonth(month));
}

module.exports = {
  listEmployees,
  createEmployee,
  recordAttendance,
  listAttendance,
  createAdvance,
  listAdvances,
  createSalary,
  paySalary,
  listSalaries,
};
