import { contextGroups, navigationLinks } from "@/components/layout/navigation-config";

/**
 * Catálogo y búsqueda de la paleta de comandos (sin React, para poder probarlo).
 * Cada entrada lleva sinónimos en lenguaje llano: la gente busca "iva", "gestor" o
 * "banco", no el nombre exacto del módulo.
 */

export type CommandKind = "action" | "navigation" | "record" | "recent";

export type Command = {
  href: string;
  label: string;
  kind: CommandKind;
  description?: string;
  /** Código `G + NN` del módulo (solo se muestra en modo teclado). */
  code?: string;
  keywords?: string;
};

/** Operaciones frecuentes, redactadas como tareas. */
export const quickActions: Command[] = [
  { href: "/invoices/new", label: "Nueva factura", kind: "action", keywords: "emitir facturar venta cobrar cliente" },
  { href: "/customers/new", label: "Nuevo cliente", kind: "action", keywords: "alta cliente crear contacto" },
  { href: "/expenses/new", label: "Registrar gasto", kind: "action", keywords: "gasto ticket factura de proveedor recibida compra recibo escanear ocr foto" },
  { href: "/sales/new", label: "Nuevo presupuesto", kind: "action", keywords: "oferta cotización crear propuesta" },
  { href: "/sales/orders/new", label: "Nuevo pedido de venta", kind: "action", keywords: "pedido cliente crear encargo" },
  { href: "/invoices", label: "Registrar cobro de una factura", kind: "action", keywords: "cobrar cobro pago cliente pendiente vencida reclamar" },
  { href: "/invoices", label: "Enviar factura por email", kind: "action", description: "Abre la factura y pulsa «Enviar por email»", keywords: "enviar email correo mandar mail factura cliente pdf" },
  { href: "/invoices/collections", label: "Recordar cobros", kind: "action", keywords: "recordatorio recordar reclamar cobros vencidas morosos impagadas deuda dunning" },
  { href: "/invoices/recurring/new", label: "Nueva factura recurrente", kind: "action", keywords: "recurrente periódica mensual cuota suscripción iguala automática plantilla" },
  { href: "/suppliers/new", label: "Nuevo proveedor", kind: "action", keywords: "alta proveedor crear acreedor" },
  { href: "/purchases/orders/new", label: "Nuevo pedido de compra", kind: "action", keywords: "comprar pedido proveedor encargar" },
  { href: "/purchases/payments", label: "Pagar a un proveedor", kind: "action", keywords: "pago proveedor deuda pagar transferencia" },
  { href: "/expenses/recurring/new", label: "Nuevo gasto recurrente", kind: "action", keywords: "recurrente periódico alquiler cuota autónomos seguridad social suscripción mensual" },
  { href: "/treasury/import", label: "Importar extracto bancario", kind: "action", keywords: "importar extracto norma 43 n43 cuaderno 43 csv excel banco movimientos" },
  { href: "/treasury/reconciliation", label: "Conciliar banco", kind: "action", keywords: "conciliar conciliación banco extracto movimientos casar punteo" },
  { href: "/treasury/bank-transactions/new", label: "Registrar movimiento bancario", kind: "action", keywords: "banco extracto movimiento cargo abono" },
  { href: "/treasury/bank-accounts/new", label: "Nueva cuenta bancaria", kind: "action", keywords: "banco iban cuenta corriente" },
  { href: "/treasury/remittances/new", label: "Nueva remesa SEPA", kind: "action", keywords: "remesa sepa pagos cobros domiciliación recibos adeudos transferencias xml devolución devoluciones" },
  { href: "/treasury/bank-connections", label: "Conectar banco", kind: "action", keywords: "conectar conexión banco psd2 open banking sincronizar automática" },
  { href: "/fiscal/new", label: "Preparar modelo fiscal", kind: "action", keywords: "iva impuestos hacienda aeat declaración trimestre 303 111 130 390 347 liquidación" },
  { href: "/fiscal", label: "Marcar modelo como presentado", kind: "action", description: "Abre el modelo en Fiscalidad y pulsa «Marcar como presentado»", keywords: "presentado presentar justificante csv aeat hacienda modelo 303 111 130 declaración" },
  { href: "/fiscal/calendar", label: "Ver plazos de impuestos", kind: "action", keywords: "iva impuestos hacienda calendario fiscal vencimientos cuándo presentar" },
  { href: "/settings/team", label: "Invitar a mi gestor o a un compañero", kind: "action", keywords: "invitar gestor asesor gestoría usuarios equipo compañero empleado permisos roles" },
  { href: "/settings/company", label: "Editar datos de la empresa", kind: "action", keywords: "datos fiscales nif cif dirección razón social logo empresa" },
  { href: "/settings/security", label: "Seguridad y contraseña", kind: "action", keywords: "contraseña clave password doble factor sesiones seguridad" },
  { href: "/auth/forgot-password", label: "Cambiar mi contraseña", kind: "action", keywords: "contraseña clave password olvidé restablecer cambiar" },
  { href: "/onboarding", label: "Asistente de puesta en marcha", kind: "action", keywords: "configurar empresa empezar primeros pasos serie numeración asistente" },
  { href: "/inventory/movements/new", label: "Registrar movimiento de stock", kind: "action", keywords: "inventario ajuste entrada salida traspaso" },
  { href: "/inventory/count", label: "Hacer recuento", kind: "action", keywords: "recuento inventario físico contar existencias stock diferencias ajuste" },
  { href: "/inventory/items/new", label: "Nuevo artículo", kind: "action", keywords: "producto servicio catálogo precio" },
  { href: "/inventory/warehouses/new", label: "Nuevo almacén", kind: "action", keywords: "ubicación nave tienda" },
  { href: "/accounting/entries/new", label: "Nuevo asiento contable", kind: "action", keywords: "contabilidad diario apunte" },
  { href: "/accounting/accounts/new", label: "Nueva cuenta contable", kind: "action", keywords: "plan contable subcuenta pgc" },
];

/** Módulos del menú y sus subpáginas (Conciliación, Calendario fiscal, Plan contable…). */
export function buildNavigationCommands(): Command[] {
  const modules: Command[] = navigationLinks.map((link) => ({
    href: link.href,
    label: link.label,
    kind: "navigation",
    code: link.code,
    keywords: link.keywords,
    description: "Módulo",
  }));
  const seen = new Set(modules.map((command) => command.href));
  const subPages: Command[] = [];
  for (const group of contextGroups) {
    for (const link of group.links) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      subPages.push({
        href: link.href,
        label: link.commandLabel ?? link.label,
        kind: "navigation",
        keywords: link.keywords,
        description: group.label,
      });
    }
  }
  return [...modules, ...subPages];
}

export function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

/**
 * 0 = la etiqueta empieza por la búsqueda, 1 = una palabra empieza por ella, 2 = la
 * contiene, 3 = coincide un sinónimo/descripción, 4 = todas las palabras de la búsqueda
 * aparecen en algún sitio; `null` = no coincide. `query` ya normalizada.
 */
export function matchScore(command: Command, query: string) {
  const label = normalizeSearchText(command.label);
  if (label.startsWith(query)) return 0;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (label.includes(query)) return 2;
  const haystack = normalizeSearchText(`${command.keywords ?? ""} ${command.description ?? ""}`);
  if (haystack.split(/\s+/).some((word) => word.startsWith(query))) return 3;
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((word) => `${label} ${haystack}`.includes(word))) return 4;
  return null;
}

/** Coincidencias ordenadas: mejor puntuación primero y, a igualdad, módulos antes que acciones. */
export function rankCommands(commands: Command[], rawQuery: string): Command[] {
  const query = normalizeSearchText(rawQuery.trim());
  if (!query) return [];
  return commands
    .map((command, order) => ({ command, order, score: matchScore(command, query) }))
    .filter((entry): entry is { command: Command; order: number; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || (left.command.kind === right.command.kind ? left.order - right.order : left.command.kind === "navigation" ? -1 : 1))
    .map((entry) => entry.command);
}
