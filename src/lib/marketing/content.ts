/**
 * Textos de la web pública (landing). Los precios, la prueba y los módulos NO se escriben aquí:
 * salen del catálogo de cobro (`src/lib/billing/catalog.ts`) y del registro de módulos
 * (`src/modules/registry.ts`), así la web nunca promete un precio distinto del que se cobra.
 */

export type FeatureGroup = {
  id: string;
  title: string;
  summary: string;
  items: readonly string[];
};

/** Lo que incluye el plan base (el núcleo de la aplicación). */
export const CORE_FEATURE_GROUPS: readonly FeatureGroup[] = [
  {
    id: "facturacion",
    title: "Facturación",
    summary: "Factura en segundos y cobra antes.",
    items: [
      "Facturas, abonos y facturas simplificadas con numeración por series",
      "VERI*FACTU: cada factura queda registrada y firmada como exige Hacienda",
      "Facturas recurrentes que se emiten y envían solas",
      "Envío por email con PDF personalizable (logo, colores, textos legales)",
      "Reclamación automática de facturas vencidas",
      "Cobros parciales y vencimientos",
    ],
  },
  {
    id: "gastos",
    title: "Gastos y proveedores",
    summary: "Todo lo que pagas, ordenado y deducible.",
    items: [
      "Gastos y facturas de proveedor con su IVA e IRPF",
      "El PDF de cada gasto guardado junto a su apunte",
      "Gastos recurrentes (alquiler, cuotas, suministros)",
      "Pagos a proveedores y vencimientos",
    ],
  },
  {
    id: "contabilidad",
    title: "Contabilidad",
    summary: "Los asientos se hacen solos; tú solo revisas.",
    items: [
      "Plan General Contable con subcuentas automáticas",
      "Asientos automáticos de ventas, compras, cobros y pagos",
      "Libro diario, mayor y sumas y saldos",
      "Balance, pérdidas y ganancias y cuentas anuales",
      "Ejercicios fiscales, cierre y apertura",
    ],
  },
  {
    id: "impuestos",
    title: "Impuestos",
    summary: "Los modelos, calculados con tus libros.",
    items: [
      "Modelos 303, 390, 347, 349, 111, 115 y 130",
      "Calendario fiscal con los plazos de tu empresa",
      "Libros registro de IVA",
      "Canarias (IGIC: 420, 425), Ceuta y Melilla (IPSI)",
      "Autónomo o sociedad: se deduce de tu NIF",
    ],
  },
  {
    id: "maestros",
    title: "Clientes, artículos y equipo",
    summary: "Una sola ficha para cada cosa.",
    items: [
      "Clientes, proveedores y artículos con su tratamiento de IVA",
      "Cuentas bancarias y formas de pago",
      "Usuarios ilimitados con permisos por rol",
      "Verificación en dos pasos y registro de actividad",
      "Acceso para tu asesoría con su propio portal",
    ],
  },
  {
    id: "ia",
    title: "Conectado a la IA",
    summary: "Pregunta a Claude o ChatGPT por tu negocio.",
    items: [
      "Conector oficial para Claude y ChatGPT",
      "«¿Cuánto me deben?», «hazme la factura de este mes»",
      "API REST documentada y claves de acceso",
      "Exportación completa de tus datos cuando quieras",
    ],
  },
];

/** Cifras que se muestran bajo el titular (deben ser ciertas siempre). */
export const PROOF_POINTS: readonly { value: string; label: string }[] = [
  { value: "VERI*FACTU", label: "de serie en cada factura" },
  { value: "7 modelos", label: "de la AEAT calculados" },
  { value: "IVA · IGIC · IPSI", label: "Península, Canarias, Ceuta y Melilla" },
  { value: "∞", label: "usuarios sin coste extra" },
];

export type Audience = { id: string; title: string; text: string; modules: readonly string[] };

/** Para quién es (y con qué módulos suele empezar cada uno). */
export const AUDIENCES: readonly Audience[] = [
  { id: "autonomos", title: "Autónomos", text: "Factura, apunta tus gastos y llega al 303 y al 130 sin hojas de cálculo.", modules: ["invoice-reading"] },
  { id: "pymes", title: "Pymes y sociedades", text: "Ventas, compras, banco y contabilidad en el mismo sitio, con usuarios ilimitados.", modules: ["sales-documents", "purchase-orders", "banking"] },
  { id: "comercios", title: "Comercios", text: "TPV de mostrador, stock por almacén y factura simplificada en el mismo sistema.", modules: ["pos", "inventory"] },
  { id: "hosteleria", title: "Bares y restaurantes", text: "Plano de mesas, comandas a cocina, reservas online, carta con QR y fichaje del equipo.", modules: ["pos", "hospitality", "timesheets"] },
  { id: "asesorias", title: "Asesorías", text: "Tus clientes trabajan en su ERP y tú entras con tu portal de asesor a revisar y cerrar.", modules: [] },
];

export type Faq = { question: string; answer: string };

/** Preguntas frecuentes. Las cifras se rellenan con el catálogo al pintar la página. */
export function buildFaqs(input: { trialDays: number; graceDays: number; welcomeCredits: number }): Faq[] {
  return [
    {
      question: "¿Necesito tarjeta para probarlo?",
      answer: `No. Creas tu cuenta y tienes ${input.trialDays} días con todos los módulos incluidos y ${input.welcomeCredits} lecturas de facturas con IA de regalo. Solo pagas si decides seguir.`,
    },
    {
      question: "¿Los precios llevan IVA?",
      answer: "No. Los precios son mensuales y sin IVA; al pagar se añade el que corresponda según tu país y tus datos fiscales. Recibes una factura legal con VERI*FACTU de cada cobro.",
    },
    {
      question: "¿Hay permanencia?",
      answer: "No. Pagas mes a mes y puedes cancelar cuando quieras desde la propia aplicación. Si añades o quitas un módulo a mitad de mes, se ajusta la parte proporcional en la siguiente factura.",
    },
    {
      question: "¿Qué pasa con mis datos si dejo de pagar?",
      answer: `Tus libros son tuyos. Si un cobro falla tienes ${input.graceDays} días para actualizar la tarjeta sin perder nada; después la cuenta pasa a solo lectura: puedes consultar y exportar todo, pero no crear ni modificar. Al reactivar, todo sigue ahí.`,
    },
    {
      question: "¿Cómo funcionan los créditos de lectura con IA?",
      answer: "Cada factura que lee la IA gasta un crédito (un PDF muy largo, alguno más). Compras packs cuando los necesites, sin cuota y sin caducidad.",
    },
    {
      question: "¿Puede entrar mi asesoría?",
      answer: "Sí, y sin pagar nada más. Tu asesoría entra con su propio portal de asesor, ve tus libros y modelos y trabaja sobre los mismos datos que tú.",
    },
    {
      question: "¿Cumple con VERI*FACTU?",
      answer: "Sí. Cada factura emitida se encadena, se firma y se envía a la Agencia Tributaria con el código QR en el PDF, también en Canarias, Ceuta y Melilla.",
    },
  ];
}
