// أدوات تنسيق الأرقام والتواريخ بالعربية والجنيه المصري

const currencyFormatter = new Intl.NumberFormat('ar-EG', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('ar-EG');

const dateFormatter = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const shortDateFormatter = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** تنسيق مبلغ بالجنيه المصري مع كلمة "ج.م" */
export function formatEGP(amount: number): string {
  return `${currencyFormatter.format(amount)} ج.م`;
}

/** تنسيق رقم بدون رمز العملة */
export function formatNumber(amount: number): string {
  return numberFormatter.format(amount);
}

/** تاريخ طويل مثل: ٢ نوفمبر ٢٠٢٦ */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return dateFormatter.format(d);
}

/** تاريخ مختصر مثل: ٢٠٢٦/١١/٠٢ */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return shortDateFormatter.format(d);
}
