const { assertIsoDate } = require('../domain/money');
const { trialBalance, profitAndLoss } = require('./accountingService');
const { listCashboxes } = require('./treasuryService');
const { listProducts } = require('./inventoryService');

function accountBalance(rows, accountId) {
  const row = rows.find((r) => r.id === accountId);
  return row ? row.debit - row.credit : 0;
}

// كل الأرقام بالقروش، والذمم الدائنة تُعرض موجبة
function dashboardSummary(db, { asOf }) {
  const date = assertIsoDate(asOf, 'تاريخ اليوم');
  const monthStart = `${date.slice(0, 7)}-01`;
  const rows = trialBalance(db, { dateTo: date }).rows;
  const products = listProducts(db);
  const profit = profitAndLoss(db, { dateFrom: monthStart, dateTo: date });
  return {
    asOf: date,
    cashOnHand: listCashboxes(db).filter((box) => box.is_active).reduce((sum, box) => sum + box.balance, 0),
    receivables: accountBalance(rows, 'acc_ar'),
    payables: 0 - accountBalance(rows, 'acc_ap'),
    stockValue: products.reduce((sum, product) => sum + product.total_value, 0),
    lowStockCount: products.filter((product) => product.is_low_stock).length,
    monthProfit: profit.netProfit,
  };
}

module.exports = { dashboardSummary };
