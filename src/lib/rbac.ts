
export type AppRole = "OWNER" | "ADMIN" | "MEMBER" | "ACCOUNTANT" | "VIEWER";

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

const readEverything: PermissionKey[] = [
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
];

/** Trabajo diario: clientes, proveedores, ventas, compras, gastos, stock y bancos. */
const dailyOperations: PermissionKey[] = [
  "customer.create",
  "supplier.create",
  "invoice.create",
  "invoice.write",
  "purchase.create",
  "purchase.write",
  "expense.write",
  "treasury.write",
  "stock.write",
];

const administration: PermissionKey[] = [
  "series.write",
  "accounting.write",
  "fiscal.write",
  "team.read",
  "team.write",
  "billing.read",
  "apiKey.read",
  "apiKey.write",
  "settings.manage",
];

const rolePermissions: Record<AppRole, Set<PermissionKey>> = {
  OWNER: new Set<PermissionKey>([...readEverything, ...dailyOperations, ...administration, "billing.write"]),
  ADMIN: new Set<PermissionKey>([...readEverything, ...dailyOperations, ...administration]),
  // Personal administrativo: opera el día a día; contabilidad, impuestos y configuración en lectura.
  MEMBER: new Set<PermissionKey>([...readEverything, ...dailyOperations]),
  // Gestor/asesor: lo ve todo y lleva contabilidad e impuestos; sin equipo, ajustes ni suscripción.
  ACCOUNTANT: new Set<PermissionKey>([...readEverything, "accounting.write", "fiscal.write"]),
  VIEWER: new Set<PermissionKey>(readEverything),
};

export const APP_ROLES = ["OWNER", "ADMIN", "MEMBER", "ACCOUNTANT", "VIEWER"] as const satisfies readonly AppRole[];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** Qué puede hacer cada rol, en lenguaje llano (diálogo de invitación y listado del equipo). */
export const roleDescriptions: Record<AppRole, string> = {
  OWNER: "Control total: empresa, equipo, suscripción y todos los módulos.",
  ADMIN: "Gestiona empresa, equipo y todos los módulos, salvo la suscripción.",
  MEMBER: "Trabajo diario: clientes, facturas, gastos, compras, stock y bancos. Contabilidad e impuestos solo en lectura.",
  ACCOUNTANT: "Para tu gestor o asesor: ve todo y lleva la contabilidad y los impuestos. Sin acceso a equipo, ajustes ni suscripción.",
  VIEWER: "Puede consultar todos los módulos, pero no crear ni modificar nada.",
};

/**
 * Roles que `actorRole` puede asignar (invitar o cambiar). Solo un propietario
 * gestiona propietarios; los administradores gestionan el resto.
 */
export function assignableRoles(actorRole: AppRole): AppRole[] {
  if (!can(actorRole, "team.write")) return [];
  return actorRole === "OWNER" ? [...APP_ROLES] : APP_ROLES.filter((role) => role !== "OWNER");
}

/** Un no propietario solo puede gestionar miembros que no sean propietarios ni administradores. */
export function canManageMemberWithRole(actorRole: AppRole, targetRole: AppRole): boolean {
  if (!can(actorRole, "team.write")) return false;
  if (actorRole === "OWNER") return true;
  return targetRole !== "OWNER" && targetRole !== "ADMIN";
}

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
