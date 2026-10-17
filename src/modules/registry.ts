/**
 * Registro de módulos opcionales. Cada empresa activa los que necesita en Configuración → Módulos;
 * lo que no está aquí es el núcleo (facturas, gastos, contabilidad, impuestos…) y siempre está.
 *
 * Un módulo declara:
 * - las rutas que le pertenecen (páginas y API, por prefijo): con el módulo desactivado, las páginas
 *   llevan a `/modules/<id>` (con opción de activarlo) y la API responde 403;
 * - si viene activado por defecto (según lo que vende la empresa);
 * - de qué otros módulos depende (no se puede activar sin ellos ni desactivarlos mientras se usa).
 *
 * Código puro (sin servidor): lo usan el menú, la paleta, Configuración y la guarda del servidor.
 * Desactivar un módulo nunca borra datos: al reactivarlo todo sigue ahí.
 */

import type { BusinessType } from "@/lib/company-readiness";

export const MODULE_IDS = ["sales-documents", "purchase-orders", "inventory", "banking", "invoice-reading", "crm", "pos", "hospitality", "timesheets"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export type ModuleCategory = "Ventas" | "Compras y gastos" | "Operaciones" | "Finanzas";

export type ModuleManifest = {
  id: ModuleId;
  name: string;
  /** Una frase: para quién es y qué resuelve. */
  description: string;
  /** Qué incluye (lista corta para la tarjeta del módulo). */
  features: readonly string[];
  category: ModuleCategory;
  /** Página principal del módulo. */
  href: string;
  /** Prefijos de ruta (páginas y API) que pertenecen al módulo. */
  routes: readonly string[];
  /** Rutas dentro de esos prefijos que son del núcleo (p. ej. el catálogo de artículos). */
  excludedRoutes?: readonly RegExp[];
  dependsOn?: readonly ModuleId[];
  /** Activado si la empresa no ha decidido nada todavía. */
  defaultEnabled: (businessType: BusinessType) => boolean;
  /** Módulo nuevo o de nicho: se destaca en Configuración. */
  isNew?: boolean;
};

export const MODULES: readonly ModuleManifest[] = [
  {
    id: "sales-documents",
    name: "Presupuestos y pedidos",
    description: "Ofertas a clientes y pedidos de venta que se convierten en factura con un clic.",
    features: ["Presupuestos con PDF y envío por email", "Pedidos de venta", "Conversión a albarán o factura"],
    category: "Ventas",
    href: "/sales/quotes",
    routes: ["/sales/quotes", "/sales/orders", "/sales/new", "/api/sales-quotes", "/api/sales-orders"],
    defaultEnabled: () => true,
  },
  {
    id: "purchase-orders",
    name: "Pedidos de compra",
    description: "Encarga a proveedores y controla lo pedido frente a lo recibido y facturado.",
    features: ["Pedidos a proveedor con PDF", "Seguimiento de lo pendiente de recibir", "Enlace con la factura del proveedor"],
    category: "Compras y gastos",
    href: "/purchases/orders",
    routes: ["/purchases/orders", "/purchases/new", "/api/purchases"],
    defaultEnabled: () => true,
  },
  {
    id: "inventory",
    name: "Inventario y almacenes",
    description: "Stock por almacén, albaranes de entrega, recepciones de mercancía y recuento.",
    features: ["Existencias y alertas de stock mínimo", "Almacenes y movimientos", "Albaranes y recepciones", "Recuento físico"],
    category: "Operaciones",
    href: "/inventory",
    routes: ["/inventory", "/sales/delivery-notes", "/purchases/receipts", "/settings/inventory", "/api/inventory", "/api/stock-movements", "/api/warehouses", "/api/delivery-notes", "/api/goods-receipts"],
    // El catálogo de artículos es del núcleo: se usa al facturar aunque no se controle stock.
    excludedRoutes: [/^\/inventory\/items(\/|$)/],
    defaultEnabled: (businessType) => businessType !== "services",
  },
  {
    id: "banking",
    name: "Banca y conciliación",
    description: "Movimientos bancarios, conciliación con facturas, remesas SEPA y previsión de tesorería.",
    features: ["Importar extractos (Norma 43, CSV, Excel)", "Conciliación asistida y reglas", "Remesas SEPA de cobro y pago", "Conexión bancaria y previsión"],
    category: "Finanzas",
    href: "/treasury",
    routes: ["/treasury", "/api/treasury", "/api/bank-transactions", "/api/bank-connections", "/api/sepa"],
    // Las cuentas bancarias son del núcleo: las usan las formas de pago y los cobros.
    excludedRoutes: [/^\/treasury\/bank-accounts(\/|$)/],
    defaultEnabled: () => true,
  },
  {
    id: "invoice-reading",
    name: "Lectura de facturas con IA",
    description: "Sube o reenvía por email las facturas de proveedor y la IA las lee y prepara para registrar.",
    features: ["Bandeja de facturas por lotes", "Lectura con IA (OpenAI)", "Buzón de correo para recibir facturas"],
    category: "Compras y gastos",
    href: "/expenses/inbox",
    routes: ["/expenses/inbox", "/settings/automation", "/api/expenses/ocr", "/api/expenses/mail-inbox", "/api/expenses/ai-analysis"],
    // El original de una factura ya registrada se sigue sirviendo aunque se desactive el módulo.
    excludedRoutes: [/^\/api\/expenses\/ocr\/[^/]+\/file$/],
    defaultEnabled: () => true,
  },
  {
    id: "crm",
    name: "CRM",
    description: "Oportunidades de venta por etapas, seguimiento de llamadas, reuniones y tareas con cada cliente.",
    features: ["Embudo de ventas por etapas (kanban)", "Actividades y tareas con vencimiento", "Previsión ponderada", "Paso a presupuesto"],
    category: "Ventas",
    href: "/crm",
    routes: ["/crm", "/api/crm"],
    defaultEnabled: () => false,
    isNew: true,
  },
  {
    id: "pos",
    name: "TPV",
    description: "Venta en mostrador: tickets (factura simplificada), cobro en efectivo o tarjeta y cierre de caja.",
    features: ["Pantalla de venta táctil", "Tickets con VeriFactu y descuento de stock", "Apertura, arqueo y cierre de caja", "Informe de cierre (Z)"],
    category: "Ventas",
    href: "/pos",
    routes: ["/pos", "/api/pos"],
    defaultEnabled: () => false,
    isNew: true,
  },
  {
    id: "hospitality",
    name: "Hostelería (mesas)",
    description: "Para bares y restaurantes: plano de mesas, reservas online, cuentas abiertas, comandas a cocina y barra y cuenta dividida.",
    features: ["Plano visual de salas y mesas", "Reservas online con formulario, QR y recordatorios", "Carta digital con QR por mesa, alérgenos e inglés", "Modificadores, menús del día y marchar por tiempos", "Escandallos con food cost y descuento de ingredientes", "Cuentas abiertas en varios dispositivos", "Comandas a cocina y barra (pantalla e impresión)", "Dividir la cuenta, propinas y camareros con PIN"],
    category: "Ventas",
    href: "/pos",
    routes: ["/pos/kitchen", "/pos/bookings", "/pos/menu", "/pos/recipes", "/api/pos/hospitality", "/api/pos/bookings", "/api/pos/menu", "/api/pos/recipes"],
    dependsOn: ["pos"],
    defaultEnabled: () => false,
    isNew: true,
  },
  {
    id: "timesheets",
    name: "Registro de jornada",
    description: "El fichaje obligatorio: cada trabajador registra su entrada, pausas y salida desde el móvil o la tablet del local.",
    features: ["Fichar desde la app o en una tablet con PIN", "Registros inalterables: correcciones con motivo", "Resumen mensual por trabajador y exportación para el gestor o la Inspección"],
    category: "Operaciones",
    href: "/jornada",
    routes: ["/jornada", "/fichar", "/api/timesheets"],
    defaultEnabled: () => false,
    isNew: true,
  },
];

const byId = new Map<ModuleId, ModuleManifest>(MODULES.map((manifest) => [manifest.id, manifest]));

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && byId.has(value as ModuleId);
}

export function getModule(id: ModuleId): ModuleManifest {
  const manifest = byId.get(id);
  if (!manifest) throw new Error(`Módulo desconocido: ${id}`);
  return manifest;
}

function routeMatches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Módulo al que pertenece una ruta (el prefijo más largo), o null si es del núcleo. */
export function moduleForPath(pathname: string): ModuleManifest | null {
  const path = pathname.split(/[?#]/)[0] || "/";
  let best: { manifest: ModuleManifest; length: number } | null = null;
  for (const manifest of MODULES) {
    if (manifest.excludedRoutes?.some((pattern) => pattern.test(path))) continue;
    for (const prefix of manifest.routes) {
      if (routeMatches(path, prefix) && (!best || prefix.length > best.length)) best = { manifest, length: prefix.length };
    }
  }
  return best?.manifest ?? null;
}

export type ModuleSetting = { moduleId: string; enabled: boolean };

/**
 * Módulos activos: lo que la empresa decidió y, para lo que no ha tocado, el valor por defecto según
 * lo que vende. Un módulo cuya dependencia está desactivada tampoco está activo.
 */
export function resolveEnabledModules(settings: readonly ModuleSetting[], businessType: BusinessType | string | null | undefined): ModuleId[] {
  const type: BusinessType = businessType === "products" || businessType === "services" ? businessType : "both";
  const explicit = new Map(settings.filter((setting) => isModuleId(setting.moduleId)).map((setting) => [setting.moduleId as ModuleId, setting.enabled]));
  const wanted = new Set(MODULES.filter((manifest) => explicit.get(manifest.id) ?? manifest.defaultEnabled(type)).map((manifest) => manifest.id));
  return MODULES.filter((manifest) => wanted.has(manifest.id) && (manifest.dependsOn ?? []).every((dependency) => wanted.has(dependency))).map((manifest) => manifest.id);
}

/** Módulos activos que dependen de `id` (impiden desactivarlo). */
export function activeDependents(id: ModuleId, enabled: readonly ModuleId[]): ModuleManifest[] {
  return MODULES.filter((manifest) => enabled.includes(manifest.id) && manifest.dependsOn?.includes(id));
}

/** Dependencias de `id` que faltan por activar. */
export function missingDependencies(id: ModuleId, enabled: readonly ModuleId[]): ModuleManifest[] {
  return (getModule(id).dependsOn ?? []).filter((dependency) => !enabled.includes(dependency)).map(getModule);
}

/** ¿Se muestra algo marcado con este módulo? Sin saber aún los módulos activos (carga) se muestra. */
export function isModuleVisible(moduleId: ModuleId | undefined, enabled: readonly string[] | null | undefined) {
  return !moduleId || !enabled || enabled.includes(moduleId);
}
