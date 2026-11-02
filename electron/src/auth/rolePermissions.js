// الصلاحيات الافتراضية لكل دور. المالك يملك كل الصلاحيات دائمًا.
const ROLE_PERMISSIONS = {
  manager: [
    'dashboard.view', 'treasury.view', 'treasury.add', 'transfers.view', 'transfers.add',
    'checks.view', 'checks.add', 'sales.view', 'sales.add', 'sales.print', 'parties.view', 'parties.add', 'parties.edit',
    'expenses.view', 'expenses.add', 'expenses.edit', 'inventory.view', 'inventory.add', 'inventory.edit',
    'accounting.view', 'accounting.add', 'employees.view', 'employees.add', 'employees.edit',
    'reports.view', 'reports.export', 'backup.view', 'import.run',
  ],
  accountant: [
    'dashboard.view', 'treasury.view', 'treasury.add', 'treasury.edit', 'transfers.view', 'transfers.add', 'transfers.edit',
    'checks.view', 'checks.add', 'checks.edit', 'sales.view', 'sales.add', 'sales.edit', 'sales.print',
    'parties.view', 'parties.add', 'parties.edit', 'expenses.view', 'expenses.add', 'expenses.edit',
    'inventory.view', 'inventory.add', 'inventory.edit', 'accounting.view', 'accounting.add', 'accounting.edit',
    'employees.view', 'reports.view', 'reports.export',
  ],
  user: ['dashboard.view'],
};

module.exports = { ROLE_PERMISSIONS };
