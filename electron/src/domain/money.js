const { UserFacingError } = require('../errors');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value, label = 'التاريخ') {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new UserFacingError(`${label} غير صالح`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new UserFacingError(`${label} غير صالح`);
  }
  return value;
}

function requireText(value, label, maxLength = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) throw new UserFacingError(`${label} مطلوب`);
  if (text.length > maxLength) throw new UserFacingError(`${label} يتجاوز ${maxLength} حرفًا`);
  return text;
}

function optionalText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text.length > maxLength) throw new UserFacingError(`النص يتجاوز ${maxLength} حرفًا`);
  return text.length > 0 ? text : null;
}

// المبالغ تُستلم وتُخزَّن كأعداد صحيحة من القروش (جنيه × 100)
function toPiastres(value, label = 'المبلغ', { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new UserFacingError(`${label} غير صالح`);
  }
  return value;
}

// الكميات تُخزَّن بأجزاء الألف (ثلاث خانات عشرية) كأعداد صحيحة
function toMilli(value, label = 'الكمية', { allowZero = false } = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) {
    throw new UserFacingError(`${label} غير صالحة`);
  }
  const milli = Math.round(n * 1000);
  if (Math.abs(milli - n * 1000) > 1e-6 || !Number.isSafeInteger(milli)) {
    throw new UserFacingError(`${label} يجب ألا تتجاوز ثلاث خانات عشرية`);
  }
  return milli;
}

function milliToNumber(milli) {
  return milli / 1000;
}

// حاصل ضرب وقسمة صحيح مع التقريب إلى أقرب عدد (نصف لأعلى) دون فقد دقة
function mulDivRound(a, b, d) {
  if (d === 0) return 0;
  const A = BigInt(a);
  const B = BigInt(b);
  const D = BigInt(d);
  return Number((2n * A * B + D) / (2n * D));
}

// توزيع مبلغ على أوزان بحيث يكون مجموع الحصص مساويًا للمبلغ تمامًا
function allocateByWeights(total, weights) {
  const sumWeights = weights.reduce((sum, w) => sum + w, 0);
  if (weights.length === 0) return [];
  if (sumWeights === 0) return weights.map((_, index) => (index === weights.length - 1 ? total : 0));
  let allocated = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return total - allocated;
    const share = mulDivRound(total, weight, sumWeights);
    allocated += share;
    return share;
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  assertIsoDate,
  requireText,
  optionalText,
  toPiastres,
  toMilli,
  milliToNumber,
  mulDivRound,
  allocateByWeights,
  todayIso,
};
