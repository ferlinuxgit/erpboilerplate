/**
 * Glosario fiscal y contable en lenguaje llano. Lo usan `<HelpTerm>` (ayuda contextual) y la
 * página /fiscal/glossary. Las definiciones son orientativas: no sustituyen al asesor.
 */

export type GlossaryEntry = {
  /** Identificador estable (ancla en la página del glosario). */
  id: string;
  term: string;
  /** Una o dos frases para la ayuda contextual. */
  short: string;
  /** Explicación ampliada para la página del glosario. */
  long?: string;
  category: "fiscal" | "contabilidad";
  /** Página de la aplicación relacionada. */
  href?: string;
};

export const glossaryEntries = [
  {
    id: "303",
    term: "Modelo 303",
    short: "Declaración del IVA. Cada trimestre (o mes) restas el IVA que has pagado en tus gastos al IVA que has cobrado en tus facturas y pagas o compensas la diferencia.",
    long: "Se presenta del 1 al 20 del mes siguiente al trimestre (el 4.º trimestre, hasta el 30 de enero), aunque no hayas facturado nada. Si sale a devolver, lo normal es compensarlo en el siguiente trimestre; solo en el último del año puedes pedir la devolución.",
    category: "fiscal",
    href: "/fiscal",
  },
  {
    id: "390",
    term: "Modelo 390",
    short: "Resumen anual del IVA: recoge en una sola declaración todos los 303 del año. Es informativo, no se paga nada con él.",
    long: "Se presenta del 1 al 30 de enero. Tiene que cuadrar con la suma de los 303 del año.",
    category: "fiscal",
  },
  {
    id: "347",
    term: "Modelo 347",
    short: "Declaración anual de operaciones con terceros: lista de clientes y proveedores españoles con los que has superado 3.005,06 € (IVA incluido) en el año.",
    long: "Se presenta en febrero. No se paga nada; sirve para que Hacienda cruce datos entre empresas. Las operaciones que ya declaras en el 349 o que llevan retención no se incluyen.",
    category: "fiscal",
  },
  {
    id: "349",
    term: "Modelo 349",
    short: "Declaración de operaciones con empresas de otros países de la UE (ventas y compras intracomunitarias). Informa a quién y cuánto; no se paga nada.",
    long: "Normalmente es trimestral y se presenta en los mismos plazos que el 303. Solo si vendes o compras a empresas de la UE con NIF-IVA.",
    category: "fiscal",
  },
  {
    id: "111",
    term: "Modelo 111",
    short: "Ingreso de las retenciones de IRPF que tú descuentas en las facturas de profesionales (gestor, abogado, diseñador…) y en las nóminas.",
    category: "fiscal",
  },
  {
    id: "115",
    term: "Modelo 115",
    short: "Ingreso de la retención del alquiler de tu local u oficina: la descuentas de la factura del casero y la pagas tú a Hacienda.",
    category: "fiscal",
  },
  {
    id: "130",
    term: "Modelo 130",
    short: "Pago a cuenta del IRPF de los autónomos en estimación directa: cada trimestre adelantas el 20 % de lo que has ganado en el año, descontando retenciones y pagos anteriores.",
    long: "No tienes que presentarlo si al menos el 70 % de tus ingresos del año anterior llevaron retención. Las sociedades no lo presentan.",
    category: "fiscal",
  },
  {
    id: "irpf",
    term: "IRPF",
    short: "Impuesto sobre la Renta de las Personas Físicas. En tus facturas aparece como retención: un porcentaje que el cliente descuenta y paga a Hacienda por ti, a cuenta de tu renta anual.",
    category: "fiscal",
  },
  {
    id: "recargo-equivalencia",
    term: "Recargo de equivalencia",
    short: "Régimen de IVA obligatorio para comerciantes minoristas autónomos. Tu proveedor te cobra un recargo extra junto al IVA y, a cambio, tú no presentas el 303.",
    category: "fiscal",
  },
  {
    id: "prorrata",
    term: "Prorrata",
    short: "Porcentaje del IVA de tus gastos que puedes deducir cuando parte de tu actividad está exenta de IVA (formación, sanidad…). Si toda tu actividad lleva IVA, es el 100 %.",
    category: "fiscal",
    href: "/fiscal/settings",
  },
  {
    id: "isp",
    term: "Inversión del sujeto pasivo",
    short: "Caso en el que quien paga el IVA a Hacienda es el cliente y no el que factura (obras entre empresas, compras a empresas de la UE…). La factura sale sin IVA y el cliente lo declara y lo deduce a la vez.",
    category: "fiscal",
  },
  {
    id: "verifactu",
    term: "VERI*FACTU",
    short: "Sistema de la ley antifraude: cada factura se guarda con una huella encadenada que impide modificarla a escondidas y, en modo VERI*FACTU, se envía a la AEAT y lleva un código QR.",
    long: "Una vez activado no se puede desactivar: solo se puede cambiar entre VERI*FACTU (con envío a la AEAT) y NO VERI*FACTU (sin envío, con más obligaciones de custodia).",
    category: "fiscal",
    href: "/fiscal/verifactu",
  },
  {
    id: "deducible",
    term: "IVA deducible",
    short: "IVA de tus compras y gastos que puedes restar del IVA que cobras. Tiene que estar en una factura completa a tu nombre y el gasto tiene que ser de la actividad.",
    category: "fiscal",
  },
  {
    id: "555",
    term: "Cuenta 555",
    short: "Partidas pendientes de aplicación: aquí quedan los movimientos del banco que todavía no sabemos a qué corresponden. Cuanto más cerca de cero, mejor conciliado está el banco.",
    long: "Antes de cerrar el ejercicio su saldo debería ser cero: concilia cada movimiento con su factura, cobro o pago, o asígnalo a la cuenta correcta (comisiones, cuotas…).",
    category: "contabilidad",
    href: "/treasury",
  },
  {
    id: "asiento",
    term: "Asiento",
    short: "Anotación en el libro diario que registra una operación. Siempre tiene al menos dos líneas y la suma del debe es igual a la del haber (está cuadrado).",
    category: "contabilidad",
    href: "/accounting/entries",
  },
  {
    id: "debe-haber",
    term: "Debe y haber",
    short: "Las dos columnas de cada apunte. En las cuentas de dinero y bienes (activo) el debe suma y el haber resta; en las deudas, el capital y los ingresos es al revés.",
    category: "contabilidad",
  },
  {
    id: "deudor-acreedor",
    term: "Saldo deudor / acreedor",
    short: "Saldo deudor: el debe supera al haber (lo normal en caja, bancos, clientes y gastos). Saldo acreedor: el haber supera al debe (lo normal en proveedores, impuestos a pagar, capital e ingresos).",
    category: "contabilidad",
  },
  {
    id: "mayor",
    term: "Libro mayor",
    short: "Todos los movimientos de una cuenta, uno detrás de otro, con el saldo acumulado. Sirve para ver por qué una cuenta tiene el saldo que tiene.",
    category: "contabilidad",
    href: "/accounting/accounts",
  },
  {
    id: "diario",
    term: "Libro diario",
    short: "Todos los asientos de la empresa por orden de fecha. Es el libro obligatorio que se legaliza y el que pide el gestor.",
    category: "contabilidad",
    href: "/accounting/entries",
  },
  {
    id: "sumas-y-saldos",
    term: "Balance de sumas y saldos",
    short: "Tabla con cada cuenta, el total de su debe, el de su haber y su saldo. Si la contabilidad está bien, la suma del debe coincide con la del haber.",
    category: "contabilidad",
    href: "/accounting/reports",
  },
  {
    id: "descuadre",
    term: "Descuadre",
    short: "Diferencia entre el total del debe y el del haber. Debe ser cero: si no lo es, algún asiento manual está mal y hay que corregirlo antes de cerrar.",
    category: "contabilidad",
  },
  {
    id: "beneficio",
    term: "Beneficio del ejercicio",
    short: "Ingresos menos gastos del periodo, sin IVA. Si sale negativo es una pérdida. Al cerrar el ejercicio pasa a la cuenta 129.",
    category: "contabilidad",
    href: "/accounting/reports",
  },
  {
    id: "cierre",
    term: "Cierre del ejercicio",
    short: "Asientos de fin de año que pasan los gastos e ingresos a la cuenta de resultado (129), saldan todas las cuentas y bloquean el año para que nadie lo modifique.",
    category: "contabilidad",
    href: "/accounting",
  },
] as const satisfies readonly GlossaryEntry[];

export type GlossaryTermId = (typeof glossaryEntries)[number]["id"];

export function getGlossaryEntry(id: GlossaryTermId): GlossaryEntry {
  const entry = glossaryEntries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Término de glosario desconocido: ${id}`);
  return entry;
}

export const GLOSSARY_HREF = "/fiscal/glossary";
