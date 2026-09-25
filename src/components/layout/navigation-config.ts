import {
  Bank,
  BookOpenText,
  BracketsCurly,
  Buildings,
  Calculator,
  ChartLineUp,
  ClipboardText,
  ClockCounterClockwise,
  Coins,
  CreditCard,
  Factory,
  FileArrowDown,
  FileText,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  SquaresFour,
  Tray,
  Truck,
  UserCircleGear,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";

import type { BusinessType } from "@/lib/company-readiness";
import { can, isAppRole, type PermissionKey } from "@/lib/rbac";

export type NavigationLink = {
  href: string;
  label: string;
  /** Código de dos cifras para `G + código` (visible solo en modo teclado). */
  code: string;
  icon: Icon;
  /** Palabras con las que la gente busca este módulo (paleta de comandos). */
  keywords?: string;
  /** Solo tiene sentido si la empresa vende productos (stock, albaranes, recepciones). */
  productsOnly?: boolean;
  /** Permiso necesario para verlo en el menú (sigue accesible por URL/búsqueda si se tiene). */
  permission?: PermissionKey;
};

export type NavigationGroup = {
  code: string;
  label: string;
  /** Grupo plegable (secciones para usuarios avanzados). */
  collapsible?: boolean;
  links: NavigationLink[];
};

export const navGroups: NavigationGroup[] = [
  {
    code: "00",
    label: "Inicio",
    links: [{ href: "/dashboard", label: "Panel", code: "01", icon: SquaresFour, keywords: "inicio resumen hoy tareas puesta en marcha" }],
  },
  {
    code: "10",
    label: "Ventas",
    links: [
      { href: "/customers", label: "Clientes", code: "10", icon: UsersThree, keywords: "cliente contactos cartera", permission: "customer.read" },
      { href: "/sales/quotes", label: "Presupuestos", code: "11", icon: FileText, keywords: "oferta cotización propuesta", permission: "invoice.read" },
      { href: "/sales/orders", label: "Pedidos", code: "12", icon: ShoppingCart, keywords: "pedido de venta encargo", permission: "invoice.read" },
      { href: "/sales/delivery-notes", label: "Albaranes", code: "13", icon: Truck, keywords: "entrega envío mercancía", productsOnly: true, permission: "invoice.read" },
      { href: "/invoices", label: "Facturas", code: "14", icon: Receipt, keywords: "facturar cobrar cobro emitidas ventas rectificativa abono", permission: "invoice.read" },
    ],
  },
  {
    code: "20",
    label: "Compras y gastos",
    links: [
      { href: "/suppliers", label: "Proveedores", code: "20", icon: Factory, keywords: "acreedor proveedor", permission: "supplier.read" },
      { href: "/purchases/orders", label: "Pedidos de compra", code: "21", icon: ClipboardText, keywords: "comprar encargo proveedor", permission: "purchase.read" },
      { href: "/purchases/receipts", label: "Recepciones", code: "22", icon: Tray, keywords: "entrada mercancía recibir", productsOnly: true, permission: "purchase.read" },
      { href: "/expenses", label: "Gastos y facturas recibidas", code: "23", icon: FileArrowDown, keywords: "gasto ticket factura de proveedor recibida ocr escanear", permission: "expense.read" },
      { href: "/purchases/payments", label: "Pagos a proveedores", code: "24", icon: Coins, keywords: "pagar deuda proveedor", permission: "purchase.read" },
    ],
  },
  {
    code: "30",
    label: "Finanzas",
    links: [
      { href: "/inventory", label: "Inventario", code: "30", icon: Package, keywords: "stock almacén existencias artículos productos", productsOnly: true, permission: "stock.read" },
      { href: "/accounting", label: "Contabilidad", code: "31", icon: BookOpenText, keywords: "asientos diario mayor balance pgc cuentas", permission: "accounting.read" },
      { href: "/treasury", label: "Tesorería", code: "32", icon: Bank, keywords: "banco bancos caja cuentas conciliar movimientos", permission: "treasury.read" },
      { href: "/fiscal", label: "Fiscalidad", code: "33", icon: Calculator, keywords: "iva impuestos hacienda aeat modelos 303 111 130 390 347 trimestre", permission: "fiscal.read" },
      { href: "/reporting", label: "Informes", code: "34", icon: ChartLineUp, keywords: "indicadores kpi estadísticas exportar excel", permission: "reporting.read" },
    ],
  },
  {
    code: "40",
    label: "Administración",
    links: [
      { href: "/settings/company", label: "Empresa", code: "40", icon: Buildings, keywords: "datos fiscales nif cif dirección logo razón social", permission: "settings.manage" },
      { href: "/settings/team", label: "Equipo", code: "41", icon: UserCircleGear, keywords: "usuarios invitar gestor asesor roles permisos", permission: "team.read" },
      { href: "/settings/security", label: "Seguridad", code: "42", icon: ShieldCheck, keywords: "contraseña doble factor sesiones ip", permission: "settings.manage" },
      { href: "/billing", label: "Suscripción", code: "43", icon: CreditCard, keywords: "plan pago tarjeta", permission: "billing.read" },
    ],
  },
  {
    code: "50",
    label: "Avanzado",
    collapsible: true,
    links: [
      { href: "/settings/masters", label: "Maestros", code: "50", icon: SlidersHorizontal, keywords: "series numeración impuestos formas de pago unidades catálogos", permission: "settings.manage" },
      { href: "/settings/api-keys", label: "API", code: "51", icon: BracketsCurly, keywords: "integración claves desarrolladores", permission: "apiKey.read" },
      { href: "/settings/audit", label: "Auditoría", code: "52", icon: ClockCounterClockwise, keywords: "historial registro cambios quién", permission: "settings.manage" },
    ],
  },
];

export type ContextGroup = {
  roots: string[];
  label: string;
  code: string;
  links: Array<{ href: string; label: string; exact?: boolean; keywords?: string; productsOnly?: boolean }>;
};

export const contextGroups: ContextGroup[] = [
  {
    roots: ["/customers", "/sales", "/invoices"],
    code: "10",
    label: "Ventas",
    links: [
      { href: "/customers", label: "Clientes" },
      { href: "/sales/quotes", label: "Presupuestos" },
      { href: "/sales/orders", label: "Pedidos" },
      { href: "/sales/delivery-notes", label: "Albaranes", productsOnly: true },
      { href: "/invoices", label: "Facturas" },
      { href: "/invoices/recurring", label: "Recurrentes", keywords: "facturas recurrentes periódicas cuotas mensuales suscripción" },
      { href: "/invoices/collections", label: "Cobros pendientes", keywords: "recordatorio reclamar cobro vencidas morosos antigüedad deuda" },
    ],
  },
  {
    roots: ["/suppliers", "/purchases", "/expenses"],
    code: "20",
    label: "Compras y gastos",
    links: [
      { href: "/suppliers", label: "Proveedores" },
      { href: "/purchases/orders", label: "Pedidos" },
      { href: "/purchases/receipts", label: "Recepciones", productsOnly: true },
      { href: "/expenses", label: "Gastos y facturas recibidas" },
      { href: "/expenses/recurring", label: "Gastos recurrentes", keywords: "alquiler cuota autónomos seguridad social suscripción periódico" },
      { href: "/purchases/payments", label: "Pagos" },
    ],
  },
  {
    roots: ["/inventory"],
    code: "30",
    label: "Inventario",
    links: [
      { href: "/inventory", label: "Existencias", exact: true, keywords: "stock" },
      { href: "/inventory/items", label: "Artículos", keywords: "productos servicios catálogo precios" },
      { href: "/inventory/warehouses", label: "Almacenes" },
      { href: "/inventory/movements", label: "Movimientos de stock", keywords: "entradas salidas ajustes traspasos" },
    ],
  },
  {
    roots: ["/accounting"],
    code: "31",
    label: "Contabilidad",
    links: [
      { href: "/accounting", label: "Resumen", exact: true },
      { href: "/accounting/accounts", label: "Plan contable", keywords: "pgc cuentas 572 430 400" },
      { href: "/accounting/entries", label: "Asientos", keywords: "libro diario apuntes" },
      { href: "/accounting/reports", label: "Estados financieros", keywords: "balance pérdidas y ganancias resultado sumas y saldos" },
    ],
  },
  {
    roots: ["/treasury"],
    code: "32",
    label: "Tesorería",
    links: [
      { href: "/treasury", label: "Resumen", exact: true },
      { href: "/treasury/bank-accounts", label: "Cuentas bancarias", keywords: "banco iban" },
      { href: "/treasury/bank-transactions", label: "Movimientos bancarios", keywords: "extracto importar csv banco" },
      { href: "/treasury/reconciliation", label: "Conciliación", keywords: "conciliar casar punteo banco cobros pagos" },
      { href: "/treasury/forecast", label: "Previsión", keywords: "previsión de tesorería liquidez futuro dinero" },
    ],
  },
  {
    roots: ["/fiscal"],
    code: "33",
    label: "Fiscalidad",
    links: [
      { href: "/fiscal", label: "Modelos", exact: true, keywords: "303 111 130 390 347 349 iva impuestos declaraciones" },
      { href: "/fiscal/calendar", label: "Calendario fiscal", keywords: "plazos vencimientos trimestre fechas hacienda" },
      { href: "/fiscal/verifactu", label: "VERI*FACTU", keywords: "verifactu registro aeat facturación antifraude" },
      { href: "/fiscal/settings", label: "Configuración fiscal", keywords: "régimen iva prorrata autónomo sociedad recargo" },
    ],
  },
  {
    roots: ["/reporting"],
    code: "34",
    label: "Informes",
    links: [
      { href: "/reporting", label: "Indicadores", exact: true, keywords: "kpi ventas gastos exportar" },
      { href: "/accounting/reports", label: "Estados financieros", keywords: "balance pérdidas y ganancias" },
      { href: "/treasury/forecast", label: "Previsión de tesorería", keywords: "liquidez" },
      { href: "/fiscal/calendar", label: "Calendario fiscal", keywords: "plazos impuestos" },
    ],
  },
  {
    roots: ["/settings", "/billing"],
    code: "40",
    label: "Administración",
    links: [
      { href: "/settings/company", label: "Empresa" },
      { href: "/settings/team", label: "Equipo" },
      { href: "/settings/security", label: "Seguridad" },
      { href: "/billing", label: "Suscripción" },
      { href: "/settings/masters", label: "Maestros" },
      { href: "/settings/api-keys", label: "API" },
      { href: "/settings/audit", label: "Auditoría" },
    ],
  },
];

export const navigationLinks: NavigationLink[] = navGroups.flatMap((group) => group.links);

/** Contexto que adapta el menú: qué vende la empresa y el rol del usuario (si ya se conocen). */
export type NavigationAudience = {
  businessType?: BusinessType | string | null;
  role?: string | null;
};

function hiddenForBusiness(entry: { productsOnly?: boolean }, businessType: NavigationAudience["businessType"]) {
  return Boolean(entry.productsOnly) && businessType === "services";
}

/**
 * Menú visible: oculta módulos de stock a empresas de servicios y los que el rol no
 * puede abrir. Mientras no se conoce el contexto se muestra completo. Los módulos
 * ocultos siguen accesibles con `G + código` y desde la búsqueda.
 */
export function filterNavigationGroups(groups: NavigationGroup[], audience: NavigationAudience): NavigationGroup[] {
  const role = isAppRole(audience.role) ? audience.role : null;
  return groups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => !hiddenForBusiness(link, audience.businessType) && (!role || !link.permission || can(role, link.permission))),
    }))
    .filter((group) => group.links.length > 0);
}

export function filterContextLinks(group: ContextGroup, audience: NavigationAudience): ContextGroup["links"] {
  return group.links.filter((link) => !hiddenForBusiness(link, audience.businessType));
}

export function isActiveRoute(pathname: string, href: string) {
  if (href === "/sales/quotes" && (pathname === "/sales/new" || pathname.startsWith("/sales/new/"))) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getContextGroup(pathname: string) {
  return contextGroups.find((group) =>
    group.roots.some((root) => pathname === root || pathname.startsWith(`${root}/`)),
  );
}
