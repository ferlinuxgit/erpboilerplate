import {
  Bank,
  BookOpenText,
  Calculator,
  CashRegister,
  ChartLineUp,
  ClipboardText,
  Clock,
  Coins,
  Factory,
  Funnel,
  FileArrowDown,
  FileText,
  GearSix,
  Package,
  Receipt,
  ShoppingCart,
  SquaresFour,
  Tray,
  Truck,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";

import { SETTINGS_HOME, settingsSections } from "@/components/settings/settings-catalog";
import type { BusinessType } from "@/lib/company-readiness";
import { can, isAppRole, type PermissionKey } from "@/lib/rbac";
import { isModuleVisible, resolveEnabledModules, type ModuleId } from "@/modules/registry";

export type NavigationLink = {
  href: string;
  label: string;
  /** Etiqueta corta para la barra inferior móvil cuando `label` no cabe. */
  shortLabel?: string;
  /** Código de dos cifras para `G + código` (visible solo en modo teclado). */
  code: string;
  icon: Icon;
  /** Palabras con las que la gente busca este módulo (paleta de comandos). */
  keywords?: string;
  /** Módulo opcional al que pertenece: solo se muestra si la empresa lo tiene activado. */
  module?: ModuleId;
  /** Solo se muestra si ese módulo está desactivado (p. ej. "Artículos" fuera del inventario). */
  unlessModule?: ModuleId;
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
      { href: "/sales/quotes", label: "Presupuestos", code: "11", icon: FileText, keywords: "oferta cotización propuesta", module: "sales-documents", permission: "invoice.read" },
      { href: "/sales/orders", label: "Pedidos", code: "12", icon: ShoppingCart, keywords: "pedido de venta encargo", module: "sales-documents", permission: "invoice.read" },
      { href: "/sales/delivery-notes", label: "Albaranes", code: "13", icon: Truck, keywords: "entrega envío mercancía", module: "inventory", permission: "invoice.read" },
      { href: "/pos", label: "TPV", code: "17", icon: CashRegister, keywords: "tpv punto de venta caja mostrador ticket tienda cobrar efectivo tarjeta cierre arqueo", module: "pos", permission: "pos.read" },
      { href: "/crm", label: "CRM", code: "16", icon: Funnel, keywords: "crm oportunidades embudo pipeline ventas seguimiento llamadas tareas leads prospectos comercial", module: "crm", permission: "crm.read" },
      { href: "/inventory/items", label: "Artículos", code: "15", icon: Package, keywords: "productos servicios catálogo precios tarifas", unlessModule: "inventory", permission: "stock.read" },
      { href: "/invoices", label: "Facturas", code: "14", icon: Receipt, keywords: "facturar cobrar cobro emitidas ventas rectificativa abono", permission: "invoice.read" },
    ],
  },
  {
    code: "20",
    label: "Compras y gastos",
    links: [
      { href: "/suppliers", label: "Proveedores", code: "20", icon: Factory, keywords: "acreedor proveedor", permission: "supplier.read" },
      { href: "/purchases/orders", label: "Pedidos de compra", shortLabel: "Compras", code: "21", icon: ClipboardText, keywords: "comprar encargo proveedor", module: "purchase-orders", permission: "purchase.read" },
      { href: "/purchases/receipts", label: "Recepciones", code: "22", icon: Tray, keywords: "entrada mercancía recibir", module: "inventory", permission: "purchase.read" },
      { href: "/expenses", label: "Gastos y facturas recibidas", shortLabel: "Gastos", code: "23", icon: FileArrowDown, keywords: "gasto ticket factura de proveedor recibida ocr escanear", permission: "expense.read" },
      { href: "/purchases/payments", label: "Pagos a proveedores", shortLabel: "Pagos", code: "24", icon: Coins, keywords: "pagar deuda proveedor", permission: "purchase.read" },
    ],
  },
  {
    code: "30",
    label: "Finanzas",
    links: [
      { href: "/inventory", label: "Inventario", code: "30", icon: Package, keywords: "stock almacén existencias artículos productos", module: "inventory", permission: "stock.read" },
      { href: "/accounting", label: "Contabilidad", code: "31", icon: BookOpenText, keywords: "asientos diario mayor balance pgc cuentas", permission: "accounting.read" },
      { href: "/treasury", label: "Tesorería", code: "32", icon: Bank, keywords: "banco bancos caja cuentas conciliar movimientos", module: "banking", permission: "treasury.read" },
      { href: "/fiscal", label: "Fiscalidad", code: "33", icon: Calculator, keywords: "iva impuestos hacienda aeat modelos 303 111 130 390 347 trimestre", permission: "fiscal.read" },
      { href: "/reporting", label: "Informes", code: "34", icon: ChartLineUp, keywords: "indicadores kpi estadísticas exportar excel", permission: "reporting.read" },
    ],
  },
  {
    code: "40",
    label: "Administración",
    links: [
      { href: "/jornada", label: "Registro de jornada", shortLabel: "Jornada", code: "41", icon: Clock, keywords: "fichar fichaje jornada horario entrada salida horas registro trabajadores inspeccion", module: "timesheets" },
      { href: SETTINGS_HOME, label: "Configuración", shortLabel: "Ajustes", code: "40", icon: GearSix, keywords: "ajustes configurar preferencias empresa equipo usuarios seguridad suscripción series impuestos formas de pago maestros api auditoría" },
    ],
  },
];

export type ContextGroup = {
  roots: string[];
  label: string;
  code: string;
  links: ContextLink[];
};

export type ContextLink = {
  href: string;
  label: string;
  /** Solo activa en la ruta exacta (p. ej. "Resumen" en `/treasury`). */
  exact?: boolean;
  keywords?: string;
  module?: ModuleId;
  unlessModule?: ModuleId;
  /** Nombre completo en la paleta de comandos cuando la pestaña es ambigua fuera de su grupo ("Recurrentes"). */
  commandLabel?: string;
  /** Permiso para ver la pestaña (sigue accesible por URL si se tiene). */
  permission?: PermissionKey;
};

export const contextGroups: ContextGroup[] = [
  {
    roots: ["/customers", "/sales", "/invoices"],
    code: "10",
    label: "Ventas",
    links: [
      { href: "/customers", label: "Clientes" },
      { href: "/sales/quotes", label: "Presupuestos", module: "sales-documents" },
      { href: "/sales/orders", label: "Pedidos", module: "sales-documents" },
      { href: "/sales/delivery-notes", label: "Albaranes", module: "inventory" },
      { href: "/invoices", label: "Facturas" },
      { href: "/invoices/collections", label: "Cobros pendientes", keywords: "recordatorio recordar reclamar cobro cobros vencidas morosos antigüedad deuda impagadas dunning" },
      { href: "/invoices/recurring", label: "Recurrentes", commandLabel: "Facturas recurrentes", keywords: "facturas recurrentes recurrente periódicas cuotas mensuales suscripción iguala" },
    ],
  },
  {
    roots: ["/pos"],
    code: "17",
    label: "TPV",
    links: [
      { href: "/pos", label: "Vender", exact: true, commandLabel: "TPV: vender", keywords: "caja mostrador ticket cobrar", module: "pos" },
      { href: "/pos/kitchen", label: "Cocina", commandLabel: "TPV: pantalla de cocina y barra", keywords: "cocina barra comandas kds pedidos platos", module: "hospitality" },
      { href: "/pos/bookings", label: "Reservas", commandLabel: "TPV: reservas de mesa", keywords: "reservas mesas reservar clientes agenda", module: "hospitality" },
      { href: "/pos/recipes", label: "Escandallos", commandLabel: "TPV: escandallos y food cost", keywords: "escandallo receta ingredientes coste food cost margen", module: "hospitality" },
      { href: "/pos/menu", label: "Carta", commandLabel: "TPV: carta digital y QR", keywords: "carta menu qr alergenos platos agotado", module: "hospitality" },
      { href: "/pos/sessions", label: "Cierres de caja", commandLabel: "TPV: cierres de caja", keywords: "arqueo informe z cierre caja turnos", module: "pos" },
      { href: "/pos/settings", label: "Cajas", commandLabel: "TPV: configurar cajas", keywords: "configurar caja serie tickets tarjeta datafono almacen", module: "pos" },
    ],
  },
  {
    roots: ["/crm"],
    code: "16",
    label: "CRM",
    links: [
      { href: "/crm", label: "Embudo", exact: true, commandLabel: "Embudo de ventas (CRM)", keywords: "pipeline kanban oportunidades", module: "crm" },
      { href: "/crm/opportunities", label: "Oportunidades", keywords: "lista oportunidades ventas leads", module: "crm" },
      { href: "/crm/activities", label: "Agenda", commandLabel: "Agenda del CRM", keywords: "tareas llamadas reuniones pendientes vencidas recordatorios", module: "crm" },
      { href: "/crm/settings", label: "Etapas", commandLabel: "Etapas del embudo (CRM)", keywords: "etapas embudo probabilidad configurar", module: "crm" },
    ],
  },
  {
    roots: ["/suppliers", "/purchases", "/expenses"],
    code: "20",
    label: "Compras y gastos",
    links: [
      { href: "/suppliers", label: "Proveedores" },
      { href: "/purchases/orders", label: "Pedidos", module: "purchase-orders" },
      { href: "/purchases/receipts", label: "Recepciones", module: "inventory" },
      { href: "/expenses", label: "Facturas de proveedor", keywords: "gastos facturas recibidas tickets" },
      { href: "/expenses/inbox", label: "Bandeja OCR", module: "invoice-reading", commandLabel: "Bandeja OCR de facturas recibidas", keywords: "bandeja ocr escanear subir pdf foto revisar facturas recibidas lote" },
      { href: "/expenses/recurring", label: "Recurrentes", commandLabel: "Gastos recurrentes", keywords: "gastos recurrentes recurrente alquiler cuota autónomos seguridad social suscripción periódico" },
      { href: "/purchases/payments", label: "Pagos" },
    ],
  },
  {
    roots: ["/inventory"],
    code: "30",
    label: "Inventario",
    links: [
      { href: "/inventory", label: "Existencias", exact: true, keywords: "stock", module: "inventory" },
      { href: "/inventory/items", label: "Artículos", keywords: "productos servicios catálogo precios" },
      { href: "/inventory/warehouses", label: "Almacenes", module: "inventory" },
      { href: "/inventory/movements", label: "Movimientos de stock", keywords: "entradas salidas ajustes traspasos", module: "inventory" },
      { href: "/inventory/count", label: "Recuento", module: "inventory", commandLabel: "Recuento de inventario", keywords: "recuento inventario físico contar existencias diferencias ajuste" },
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
      { href: "/accounting/gestor", label: "Paquete para el gestor", keywords: "gestor gestoría asesor exportar enviar zip trimestre cierre documentación" },
    ],
  },
  {
    roots: ["/treasury"],
    code: "32",
    label: "Tesorería",
    links: [
      { href: "/treasury", label: "Resumen", exact: true , module: "banking" },
      { href: "/treasury/bank-accounts", label: "Cuentas bancarias", keywords: "banco iban" },
      { href: "/treasury/bank-transactions", label: "Movimientos bancarios", keywords: "extracto importar csv banco" , module: "banking" },
      { href: "/treasury/import", label: "Importar extracto", commandLabel: "Importar extracto bancario", keywords: "importar extracto norma 43 n43 cuaderno 43 csv excel banco movimientos" , module: "banking" },
      { href: "/treasury/reconciliation", label: "Conciliación", keywords: "conciliar casar punteo banco cobros pagos" , module: "banking" },
      { href: "/treasury/rules", label: "Reglas", commandLabel: "Reglas de conciliación", keywords: "reglas automáticas conciliación categorizar banco" , module: "banking" },
      { href: "/treasury/remittances", label: "Remesas", commandLabel: "Remesas SEPA", keywords: "remesa remesas sepa pagos cobros domiciliación recibos adeudos transferencias xml devolución devoluciones" , module: "banking" },
      { href: "/treasury/bank-connections", label: "Conexión bancaria", keywords: "conectar banco psd2 open banking sincronizar automática agregador" , module: "banking" },
      { href: "/treasury/forecast", label: "Previsión", keywords: "previsión de tesorería liquidez futuro dinero" , module: "banking" },
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
      { href: "/settings/fiscal", label: "Configuración fiscal", keywords: "régimen iva prorrata autónomo sociedad recargo" },
      { href: "/fiscal/glossary", label: "Glosario", commandLabel: "Glosario fiscal", keywords: "glosario ayuda qué es términos 303 555 recargo irpf devolución" },
    ],
  },
  {
    roots: ["/reporting"],
    code: "34",
    label: "Informes",
    links: [
      { href: "/reporting", label: "Indicadores", exact: true, keywords: "kpi ventas gastos exportar" },
      { href: "/accounting/reports", label: "Estados financieros", keywords: "balance pérdidas y ganancias" },
      { href: "/treasury/forecast", label: "Previsión de tesorería", keywords: "liquidez", module: "banking" },
      { href: "/fiscal/calendar", label: "Calendario fiscal", keywords: "plazos impuestos" },
    ],
  },
  {
    roots: [SETTINGS_HOME, "/billing"],
    code: "40",
    label: "Configuración",
    links: [
      { href: SETTINGS_HOME, label: "Inicio", exact: true, commandLabel: "Configuración" },
      ...settingsSections.flatMap((section) => section.href
        ? [{ href: section.href, label: section.label, commandLabel: `Configuración: ${section.label}`, keywords: section.items.map((item) => item.keywords ?? "").join(" "), permission: section.permission, module: section.module }]
        : []),
    ],
  },
];

export const navigationLinks: NavigationLink[] = navGroups.flatMap((group) => group.links);

/** Contexto que adapta el menú: módulos activos de la empresa y el rol del usuario (si ya se conocen). */
export type NavigationAudience = {
  /** Módulos activos. Si falta, se deducen los de por defecto según lo que vende la empresa. */
  modules?: readonly string[] | null;
  businessType?: BusinessType | string | null;
  role?: string | null;
};

function audienceModules(audience: NavigationAudience): readonly string[] | null {
  if (audience.modules) return audience.modules;
  return audience.businessType ? resolveEnabledModules([], audience.businessType) : null;
}

function visibleFor(entry: { module?: ModuleId; unlessModule?: ModuleId; permission?: PermissionKey }, audience: NavigationAudience) {
  const modules = audienceModules(audience);
  if (!isModuleVisible(entry.module, modules)) return false;
  // "Solo si el módulo está desactivado": mientras no se conocen los módulos, no se muestra (evita duplicados).
  if (entry.unlessModule && (!modules || modules.includes(entry.unlessModule))) return false;
  const role = isAppRole(audience.role) ? audience.role : null;
  return !role || !entry.permission || can(role, entry.permission);
}

/**
 * Menú visible: oculta los módulos que la empresa no tiene activados y lo que el rol no
 * puede abrir. Mientras no se conoce el contexto se muestra completo.
 */
export function filterNavigationGroups(groups: NavigationGroup[], audience: NavigationAudience): NavigationGroup[] {
  return groups
    .map((group) => ({ ...group, links: group.links.filter((link) => visibleFor(link, audience)) }))
    .filter((group) => group.links.length > 0);
}

/** Destinos preferidos de la barra inferior móvil, en orden: los que más se usan a diario. */
export const MOBILE_TASKBAR_PREFERRED_HREFS = ["/dashboard", "/invoices", "/expenses", "/treasury"] as const;
export const MOBILE_TASKBAR_SIZE = 4;

/**
 * Accesos de la barra inferior móvil sobre el menú ya filtrado (rol y tipo de negocio):
 * primero los preferidos que el usuario puede ver y, si falta alguno, se completa con
 * los siguientes módulos visibles en el orden del menú. Las secciones plegables
 * (avanzadas) nunca entran.
 */
export function getMobileTaskbarLinks(groups: NavigationGroup[], size = MOBILE_TASKBAR_SIZE): NavigationLink[] {
  const visible = groups.filter((group) => !group.collapsible).flatMap((group) => group.links);
  const preferred = MOBILE_TASKBAR_PREFERRED_HREFS
    .map((href) => visible.find((link) => link.href === href))
    .filter((link): link is NavigationLink => Boolean(link));
  const fallback = visible.filter((link) => !preferred.includes(link));
  return [...preferred, ...fallback].slice(0, size);
}

export function filterContextLinks(group: ContextGroup, audience: NavigationAudience): ContextGroup["links"] {
  return group.links.filter((link) => visibleFor(link, audience));
}

export function isActiveRoute(pathname: string, href: string) {
  if (href === "/sales/quotes" && (pathname === "/sales/new" || pathname.startsWith("/sales/new/"))) return true;
  // La suscripción es una sección de Configuración aunque viva en /billing (retorno de Stripe).
  if (href === SETTINGS_HOME && (pathname === "/billing" || pathname.startsWith("/billing/"))) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Pestaña de contexto activa: la más específica que coincide. Así "Recurrentes"
 * (`/invoices/recurring/…`) no enciende también "Facturas" (`/invoices`).
 */
export function getActiveContextHref(pathname: string, links: readonly Pick<ContextLink, "href" | "exact">[]): string | null {
  let best: string | null = null;
  for (const link of links) {
    const matches = link.exact ? pathname === link.href : isActiveRoute(pathname, link.href);
    if (matches && (best === null || link.href.length > best.length)) best = link.href;
  }
  return best;
}

export function getContextGroup(pathname: string) {
  return contextGroups.find((group) =>
    group.roots.some((root) => pathname === root || pathname.startsWith(`${root}/`)),
  );
}
