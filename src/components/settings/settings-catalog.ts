import type { BusinessType } from "@/lib/company-readiness";
import { can, isAppRole, type PermissionKey } from "@/lib/rbac";

/**
 * Mapa único de la configuración: alimenta las pestañas de Configuración, el índice con
 * buscador (`/settings`) y la paleta de comandos. Cada ajuste aparece una sola vez, en la
 * sección donde la gente lo buscaría; los que viven en su módulo (cuentas bancarias, plan
 * contable…) se enlazan desde aquí en lugar de duplicarse.
 */

export type SettingsItem = {
  label: string;
  description: string;
  /** Ruta con ancla a la sección concreta (`/settings/documents#series`). */
  href: string;
  /** Sinónimos en lenguaje llano para el buscador y la paleta. */
  keywords?: string;
  permission?: PermissionKey;
  productsOnly?: boolean;
  /** Vive en otro módulo: se marca como enlace externo a la configuración. */
  external?: boolean;
};

export type SettingsSection = {
  id: string;
  label: string;
  description: string;
  /** Página de la sección; sin ella la sección solo agrupa enlaces a otros módulos. */
  href?: string;
  /** Permiso para abrir la página de la sección. */
  permission?: PermissionKey;
  productsOnly?: boolean;
  items: SettingsItem[];
};

export const SETTINGS_HOME = "/settings";

export const settingsSections: SettingsSection[] = [
  {
    id: "company",
    label: "Empresa",
    description: "Quién factura: datos fiscales, dirección, contacto y qué vendes.",
    href: "/settings/company",
    permission: "settings.manage",
    items: [
      { label: "Datos fiscales y contacto", description: "Razón social, NIF, dirección, email, teléfono, web y zona horaria.", href: "/settings/company#perfil", keywords: "nif cif razon social nombre comercial direccion domicilio codigo postal ciudad provincia pais moneda email telefono web zona horaria emisor" },
      { label: "Actividad", description: "Productos, servicios o ambos: adapta el menú (inventario, albaranes…).", href: "/settings/company#actividad", keywords: "productos servicios tipo de negocio inventario albaranes menu" },
    ],
  },
  {
    id: "documents",
    label: "Documentos",
    description: "Cómo salen tus facturas y documentos: logo, pie, contenido del PDF y numeración.",
    href: "/settings/documents",
    permission: "settings.manage",
    items: [
      { label: "Logo y pie de factura", description: "Imagen de la empresa y texto legal al pie de los documentos.", href: "/settings/documents#logo", keywords: "logo imagen marca pie de factura texto legal registro mercantil" },
      { label: "Contenido del PDF", description: "Qué datos aparecen en facturas, presupuestos y pedidos, con vista previa.", href: "/settings/documents#pdf", keywords: "pdf diseno plantilla mostrar ocultar desglose iva forma de pago numero de cliente" },
      { label: "Series de numeración", description: "Prefijos, formato y siguiente número de facturas, presupuestos, pedidos…", href: "/settings/documents#series", keywords: "serie series numeracion numero prefijo formato contador correlativo FA rectificativa" },
    ],
  },
  {
    id: "fiscal",
    label: "Fiscalidad",
    description: "Cómo tributas, VERI*FACTU y los tipos de impuesto que usas.",
    href: "/settings/fiscal",
    permission: "fiscal.read",
    items: [
      { label: "Perfil fiscal", description: "Sociedad o autónomo, régimen de IVA, periodicidad, prorrata y SII.", href: "/settings/fiscal#perfil", keywords: "regimen iva autonomo sociedad recargo de equivalencia criterio de caja exento trimestral mensual prorrata sii modelos", permission: "fiscal.write" },
      { label: "VERI*FACTU", description: "Registro antifraude de facturas y envío a Hacienda (QR en las facturas).", href: "/settings/fiscal#verifactu", keywords: "verifactu veri factu antifraude aeat hacienda qr registro facturacion", permission: "fiscal.write" },
      { label: "Impuestos y retenciones", description: "Tipos de IVA, recargo de equivalencia e IRPF que se proponen en las líneas.", href: "/settings/fiscal#impuestos", keywords: "iva 21 10 4 tipos impuesto recargo retencion irpf 15 7 porcentaje", permission: "settings.manage" },
    ],
  },
  {
    id: "payments",
    label: "Cobros y pagos",
    description: "Formas de pago, recibos domiciliados y los emails de facturas y recordatorios.",
    href: "/settings/payments",
    permission: "invoice.read",
    items: [
      { label: "Formas de pago", description: "Transferencia, domiciliación, tarjeta… y la cuenta (IBAN) que aparece en la factura.", href: "/settings/payments#formas-de-pago", keywords: "forma de pago metodo transferencia iban cuenta domiciliacion tarjeta efectivo bizum", permission: "settings.manage" },
      { label: "Recibos domiciliados (SEPA)", description: "Identificador de acreedor para cobrar remesas de adeudos directos.", href: "/settings/payments#sepa", keywords: "sepa acreedor identificador adeudo directo domiciliacion remesa recibos", permission: "settings.manage" },
      { label: "Emails y recordatorios de cobro", description: "Textos al enviar facturas y recordatorios automáticos de cobros vencidos.", href: "/settings/payments#emails", keywords: "email correo plantilla mensaje asunto recordatorio reclamar cobro vencidas dunning automatico copia" },
    ],
  },
  {
    id: "accounting",
    label: "Contabilidad",
    description: "Plantilla contable, longitud de subcuentas y cuentas y diarios predefinidos.",
    href: "/settings/accounting",
    permission: "settings.manage",
    items: [
      { label: "Plantilla de la empresa", description: "Comprueba y repara lo necesario para contabilizar sin códigos a mano.", href: "/settings/accounting#plantilla", keywords: "plantilla reparar configuracion por defecto pgc cuentas diarios ejercicio" },
      { label: "Longitud de subcuentas", description: "Dígitos de las subcuentas de clientes, proveedores, IVA…", href: "/settings/accounting#subcuentas", keywords: "subcuenta digitos longitud 8 10 12 430 400" },
      { label: "Cuentas y diarios predefinidos", description: "Crea cuentas y diarios del catálogo que falten.", href: "/settings/accounting#catalogo", keywords: "cuentas diarios catalogo pgc predefinidas crear" },
      { label: "Plan contable", description: "Todas las cuentas de la empresa.", href: "/accounting/accounts", keywords: "plan contable cuentas pgc 572 430 400", permission: "accounting.read", external: true },
    ],
  },
  {
    id: "banks",
    label: "Bancos",
    description: "Cuentas bancarias, conexión automática y reglas de conciliación (en Tesorería).",
    items: [
      { label: "Cuentas bancarias", description: "Bancos y pasarelas de pago, IBAN, BIC y su cuenta contable.", href: "/treasury/bank-accounts", keywords: "banco cuenta iban bic pasarela stripe paypal", permission: "treasury.read", external: true },
      { label: "Conexión bancaria", description: "Descarga automática de movimientos de tu banco.", href: "/treasury/bank-connections", keywords: "conectar banco psd2 open banking sincronizar automatico", permission: "treasury.read", external: true },
      { label: "Reglas de conciliación", description: "Categoriza movimientos repetidos automáticamente.", href: "/treasury/rules", keywords: "reglas conciliacion automatica categorizar movimientos", permission: "treasury.read", external: true },
    ],
  },
  {
    id: "inventory",
    label: "Inventario",
    description: "Almacenes, categorías de artículos y unidades de medida.",
    href: "/settings/inventory",
    permission: "stock.write",
    productsOnly: true,
    items: [
      { label: "Categorías de artículos", description: "Agrupa tu catálogo de productos y servicios.", href: "/settings/inventory#categorias", keywords: "categoria familia articulos productos catalogo" },
      { label: "Unidades de medida", description: "Unidades, horas, kilos, metros…", href: "/settings/inventory#unidades", keywords: "unidad medida ud kg horas metros" },
      { label: "Almacenes", description: "Ubicaciones donde guardas el stock.", href: "/inventory/warehouses", keywords: "almacen ubicacion nave tienda stock", permission: "stock.read", external: true },
    ],
  },
  {
    id: "automation",
    label: "Automatización",
    description: "Lectura automática de facturas recibidas.",
    href: "/settings/automation",
    permission: "settings.manage",
    items: [
      { label: "Lectura de facturas con IA", description: "Permite usar OpenAI para leer facturas recibidas (servicio externo).", href: "/settings/automation#ocr", keywords: "ocr ia inteligencia artificial openai leer escanear facturas recibidas privacidad" },
    ],
  },
  {
    id: "team",
    label: "Equipo",
    description: "Usuarios, roles e invitaciones (también a tu gestor).",
    href: "/settings/team",
    permission: "team.read",
    items: [
      { label: "Miembros e invitaciones", description: "Invita a compañeros o a tu gestor y cambia sus permisos.", href: "/settings/team", keywords: "usuarios invitar gestor asesor gestoria roles permisos miembros equipo" },
    ],
  },
  {
    id: "security",
    label: "Seguridad",
    description: "Política de acceso del espacio de trabajo.",
    href: "/settings/security",
    items: [
      { label: "Política de seguridad", description: "Duración de sesión, doble factor, dominios e IPs permitidas, rotación de claves API.", href: "/settings/security", keywords: "sesion doble factor 2fa dominios ip permitidas rotacion claves seguridad" },
      { label: "Cambiar mi contraseña", description: "Te enviamos un enlace para elegir una nueva.", href: "/auth/forgot-password", keywords: "contrasena clave password cambiar restablecer" },
    ],
  },
  {
    id: "api",
    label: "API",
    description: "Claves de acceso para integraciones.",
    href: "/settings/api-keys",
    permission: "apiKey.read",
    items: [
      { label: "Claves API", description: "Crea y revoca claves para conectar otros programas.", href: "/settings/api-keys", keywords: "api clave token integracion desarrolladores webhook" },
    ],
  },
  {
    id: "audit",
    label: "Auditoría",
    description: "Historial de cambios: quién hizo qué y cuándo.",
    href: "/settings/audit",
    permission: "settings.manage",
    items: [
      { label: "Registro de auditoría", description: "Consulta los cambios hechos en la empresa.", href: "/settings/audit", keywords: "historial registro cambios quien auditoria log" },
    ],
  },
  {
    id: "billing",
    label: "Suscripción",
    description: "Tu plan, sus límites y el pago.",
    href: "/billing",
    permission: "billing.read",
    items: [
      { label: "Plan y facturación", description: "Contrata o cambia de plan y descarga las facturas de la suscripción.", href: "/billing", keywords: "plan suscripcion pago tarjeta stripe limites" },
    ],
  },
];

export type SettingsAudience = {
  role?: string | null;
  businessType?: BusinessType | string | null;
};

function allowed(entry: { permission?: PermissionKey; productsOnly?: boolean }, audience: SettingsAudience) {
  if (entry.productsOnly && audience.businessType === "services") return false;
  if (!entry.permission) return true;
  // Mientras no se conoce el rol (carga) se muestra; el servidor vuelve a comprobarlo al abrir.
  return !isAppRole(audience.role) || can(audience.role, entry.permission);
}

/**
 * Secciones visibles para el rol y el tipo de negocio, con sus ajustes ya filtrados. Una
 * sección sin página solo aparece si le queda algún enlace.
 */
export function visibleSettingsSections(audience: SettingsAudience, sections = settingsSections): SettingsSection[] {
  return sections
    .filter((section) => allowed(section, audience))
    .map((section) => ({ ...section, items: section.items.filter((item) => allowed(item, audience)) }))
    .filter((section) => section.items.length > 0);
}
