/**
 * اختبارات آلية للمنطق المالي الأساسي
 *
 * تختبر هذه الوحدة الدوال النقية (pure functions) دون الحاجة إلى قاعدة بيانات:
 *  1. تحويل الجنيه إلى قرش وبالعكس (toCents / toEgp)
 *  2. التحقق من توازن القيود المحاسبية (منطق createJournalEntry)
 *  3. حساب المتوسط المرجح لتكلفة المخزون (منطق recordStockMovement)
 *  4. تجميع أرصدة الأطراف (منطق كشف حساب الطرف)
 *  5. ترقيم المستندات (منطق nextDocNumber)
 *  6. صلاحيات الأدوار
 *
 * التشغيل: npx tsx src/lib/finance.test.ts
 */

// نسخة محلية من دوال التحويل (مطابقة لـ src/db/db.ts) لتفادي مشكلة alias في tsx
const CENTS_PER_EGP = 100;
function toCents(egp: number): number {
  return Math.round(egp * CENTS_PER_EGP);
}
function toEgp(cents: number): number {
  return cents / CENTS_PER_EGP;
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    // console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function approx(a: number, b: number, eps = 0.0001): boolean {
  return Math.abs(a - b) < eps;
}

// ===================== 1. تحويل العملة =====================
function testCentsConversion(): void {
  assert(toCents(0) === 0, 'صفر يبقى صفر');
  assert(toCents(1) === 100, 'جنيه واحد = 100 قرش');
  assert(toCents(1.5) === 150, '1.5 جنيه = 150 قرش');
  assert(toCents(0.01) === 1, 'قرش واحد = 1');
  assert(toCents(1234.56) === 123456, '1234.56 جنيه = 123456 قرش');
  assert(toCents(0.005) === 1, 'التقريب: 0.005 → 1 قرش (نصف قرش يُقرب)');
  assert(toCents(0.004) === 0, 'التقريب: 0.004 → 0 قرش');
  assert(toEgp(100) === 1, '100 قرش = 1 جنيه');
  assert(toEgp(123456) === 1234.56, '123456 قرش = 1234.56 جنيه');
  assert(toEgp(toCents(99.99)) === 99.99, 'تحويل ذهاب وإياب يحافظ على القيمة');
  assert(CENTS_PER_EGP === 100, 'ثابت القروش = 100');
}

// ===================== 2. توازن القيود المحاسبية =====================
function testJournalBalance(): void {
  // نفس منطق createJournalEntry في accountingService.ts
  function isBalanced(lines: { debit: number; credit: number }[]): boolean {
    const totalDebit = lines.reduce((s, l) => s + toCents(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + toCents(l.credit), 0);
    return totalDebit === totalCredit && totalDebit > 0;
  }

  assert(isBalanced([{ debit: 100, credit: 100 }]), 'قيد متوازن بسيط');
  assert(!isBalanced([{ debit: 100, credit: 50 }]), 'قيد غير متوازن');
  assert(!isBalanced([{ debit: 0, credit: 0 }]), 'قيد بصفر مرفوض');
  assert(
    isBalanced([
      { debit: 1000, credit: 0 },
      { debit: 0, credit: 600 },
      { debit: 0, credit: 400 },
    ]),
    'قيد متعدد الأسطر متوازن'
  );
  assert(
    !isBalanced([
      { debit: 1000, credit: 0 },
      { debit: 0, credit: 999.99 },
    ]),
    'فروق صغيرة جدًا تُكشف (بسبب القروش الصحيحة)'
  );
  // تحقق أن الفاصلة العشرية لا تسبب خطأ تراكمي
  assert(
    isBalanced([
      { debit: 33.33, credit: 0 },
      { debit: 33.33, credit: 0 },
      { debit: 33.34, credit: 0 },
      { debit: 0, credit: 100 },
    ]),
    'مجموع القروش يطابق تمامًا (لا خطأ فاصلة عائمة)'
  );
}

// ===================== 3. المتوسط المرجح =====================
function testWeightedAverage(): void {
  // نفس منطق recordStockMovement في inventoryService.ts
  function weightedAvg(
    oldQty: number,
    oldAvgCostCents: number,
    inQty: number,
    inUnitCostCents: number
  ): number {
    const totalCost = oldQty * oldAvgCostCents + inQty * inUnitCostCents;
    const newQty = oldQty + inQty;
    return newQty > 0 ? totalCost / newQty : oldAvgCostCents;
  }

  // شراء 100 وحدة بـ 10 جنيه
  assert(approx(weightedAvg(0, 0, 100, toCents(10)), toCents(10)), 'أول شراء: المتوسط = سعر الشراء');
  // إضافة 50 وحدة بـ 15 جنيه → (100*1000 + 50*1500) / 150 = 1166.67
  assert(approx(weightedAvg(100, toCents(10), 50, toCents(15)), 1166.6667, 0.5), 'شراء ثاني يرفع المتوسط');
  // إضافة بكمية صفر لا يغير المتوسط
  assert(approx(weightedAvg(100, toCents(10), 0, toCents(20)), toCents(10)), 'كمية صفر لا تغير المتوسط');
  // إضافة بكمية كبيرة تخفّض المتوسط
  assert(weightedAvg(10, toCents(100), 90, toCents(10)) < toCents(100), 'كمية كبيرة بسعر أقل تخفض المتوسط');
}

// ===================== 4. كشف حساب الطرف =====================
function testPartyStatement(): void {
  // محاكاة منطق getPartyStatement في partyService.ts
  interface TxRow { debit: number; credit: number; }
  function computeClosing(openingCents: number, rows: TxRow[]): number {
    let balance = openingCents;
    for (const r of rows) balance += r.debit - r.credit;
    return balance;
  }

  assert(computeClosing(0, []) === 0, 'لا حركات = الرصيد الافتتاحي');
  assert(
    computeClosing(toCents(1000), [{ debit: toCents(500), credit: 0 }]) === toCents(1500),
    'فاتورة مبيعات تزيد رصيد العميل'
  );
  assert(
    computeClosing(toCents(1000), [{ debit: 0, credit: toCents(300) }]) === toCents(700),
    'سداد يقلل رصيد العميل'
  );
  assert(
    computeClosing(0, [
      { debit: toCents(1000), credit: 0 },
      { debit: 0, credit: toCents(400) },
      { debit: toCents(200), credit: 0 },
    ]) === toCents(800),
    'تجميع عدة حركات'
  );
  assert(
    computeClosing(toCents(500), [
      { debit: 0, credit: toCents(500) },
    ]) === 0,
    'سداد كامل يصفّر الرصيد'
  );
}

// ===================== 5. ترقيم المستندات =====================
function testDocumentNumbering(): void {
  // محاكاة منطق nextDocNumber
  function formatDoc(prefix: string, next: number, padding: number): string {
    return `${prefix}-${String(next).padStart(padding, '0')}`;
  }

  assert(formatDoc('JV', 1, 5) === 'JV-00001', 'أول قيد: JV-00001');
  assert(formatDoc('INV', 42, 4) === 'INV-0042', 'فاتورة 42: INV-0042');
  assert(formatDoc('PAY', 1000, 5) === 'PAY-01000', 'سند 1000: PAY-01000');
}

// ===================== 6. صلاحيات الأدوار =====================
function testRolePermissions(): void {
  const ROLE_PERMISSIONS: Record<string, string[]> = {
    manager: ['dashboard.view', 'treasury.view', 'accounting.view', 'reports.export'],
    accountant: ['dashboard.view', 'treasury.view', 'accounting.view', 'accounting.add'],
    user: ['dashboard.view'],
  };

  function hasPermission(roleId: string, perm: string): boolean {
    return (ROLE_PERMISSIONS[roleId] ?? []).includes(perm);
  }

  assert(hasPermission('manager', 'reports.export'), 'المدير يملك صلاحية التقارير');
  assert(!hasPermission('user', 'reports.export'), 'المستخدم العادي لا يملك التقارير');
  assert(hasPermission('accountant', 'accounting.add'), 'المحاسب يملك إضافة القيود');
  assert(!hasPermission('user', 'treasury.view'), 'المستخدم العادي لا يرى الخزينة');
  assert(!hasPermission('manager', 'nonexistent.perm'), 'صلاحية غير موجودة = false');
}

// ===================== تشغيل الكل =====================
console.log('\n🧪 اختبارات المنطق المالي\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

console.log('\n1. تحويل العملة (toCents/toEgp)');
testCentsConversion();

console.log('\n2. توازن القيود المحاسبية');
testJournalBalance();

console.log('\n3. المتوسط المرجح للمخزون');
testWeightedAverage();

console.log('\n4. كشف حساب الطرف');
testPartyStatement();

console.log('\n5. ترقيم المستندات');
testDocumentNumbering();

console.log('\n6. صلاحيات الأدوار');
testRolePermissions();

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ نجح: ${passed} | ❌ فشل: ${failed}\n`);

if (failed > 0) process.exit(1);
