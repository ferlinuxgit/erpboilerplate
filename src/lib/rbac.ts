
export type AppRole = "OWNER" | "ADMIN" | "MEMBER";

export type PermissionKey =
  | "customer.read"
  | "customer.create"
  | "supplier.read"
  | "supplier.create"
  | "invoice.read"
  | "invoice.create"
  | "invoice.write"
  | "purchase.read"
  | "purchase.create"
  | "purchase.write"
  | "expense.read"
  | "expense.write"
  | "treasury.read"
  | "treasury.write"
  | "stock.read"
  | "stock.write"
  | "series.read"
  | "series.write"
  | "accounting.read"
  | "accounting.write"
  | "fiscal.read"
  | "fiscal.write"
  | "team.read"
  | "team.write"
  | "billing.read"
  | "billing.write"
  | "reporting.read"
  | "apiKey.read"
  | "apiKey.write"
  | "settings.manage";

const rolePermissions: Record<AppRole, Set<PermissionKey>> = {
  OWNER: new Set<PermissionKey>([
    "customer.read",
    "customer.create",
    "supplier.read",
    "supplier.create",
    "invoice.read",
    "invoice.create",
    "invoice.write",
    "purchase.read",
    "purchase.create",
    "purchase.write",
    "expense.read",
    "expense.write",
    "treasury.read",
    "treasury.write",
    "stock.read",
    "stock.write",
    "series.read",
    "series.write",
    "accounting.read",
    "accounting.write",
    "fiscal.read",
    "fiscal.write",
    "team.read",
    "team.write",
    "billing.read",
    "billing.write",
    "reporting.read",
    "apiKey.read",
    "apiKey.write",
    "settings.manage",
  ]),
  ADMIN: new Set<PermissionKey>([
    "customer.read",
    "customer.create",
    "supplier.read",
    "supplier.create",
    "invoice.read",
    "invoice.create",
    "invoice.write",
    "purchase.read",
    "purchase.create",
    "purchase.write",
    "expense.read",
    "expense.write",
    "treasury.read",
    "treasury.write",
    "stock.read",
    "stock.write",
    "series.read",
    "series.write",
    "accounting.read",
    "accounting.write",
    "fiscal.read",
    "fiscal.write",
    "team.read",
    "team.write",
    "billing.read",
    "reporting.read",
    "apiKey.read",
    "apiKey.write",
    "settings.manage",
  ]),
  MEMBER: new Set<PermissionKey>([
    "customer.read",
    "supplier.read",
    "invoice.read",
    "purchase.read",
    "expense.read",
    "treasury.read",
    "stock.read",
    "series.read",
    "accounting.read",
    "fiscal.read",
    "reporting.read",
  ]),
};

export function can(role: AppRole, permission: PermissionKey): boolean {
  return rolePermissions[role].has(permission);
}

export function canManageCustomers(role: AppRole): boolean {
  return can(role, "customer.create");
}

export function canManageSuppliers(role: AppRole): boolean {
  return can(role, "supplier.create");
}

export function canManageInvoices(role: AppRole): boolean {
  return can(role, "invoice.create");
}

export async function canFromDb(role: AppRole, permissionKey: PermissionKey): Promise<boolean> {
  return can(role, permissionKey);
}
