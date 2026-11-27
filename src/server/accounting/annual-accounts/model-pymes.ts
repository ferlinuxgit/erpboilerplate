/**
 * Balance y cuenta de pérdidas y ganancias en el MODELO DE PYMES (Plan General de Contabilidad de
 * Pequeñas y Medianas Empresas, Real Decreto 1515/2007, tercera parte).
 *
 * El reparto de cuentas por epígrafe es el de la columna «N.º cuentas» del BOE (BOE-A-2007-19966,
 * texto consolidado). Criterios para lo que la tabla no cita, iguales a los del modelo abreviado:
 * - 473 (retenciones y pagos a cuenta) → «Otros deudores»; 5585 acompaña a la 5580; 466 → «Otros acreedores».
 * - 550, 552, 553 y 554 se tratan como la 551: activo o pasivo según el saldo.
 * - 678 y 778 (gastos e ingresos excepcionales) → «Otros resultados», dentro del resultado de explotación.
 *
 * CUENTAS QUE EL PLAN DE PYMES NO TIENE. El cuadro de cuentas de la aplicación es el del PGC
 * completo. Si una empresa que presenta en modelo de PYMES usa una cuenta que su plan no contempla
 * (`foreign`: instrumentos compuestos, ajustes por cambios de valor, grupos 8 y 9, activos mantenidos
 * para la venta, derivados de cobertura…), su saldo se lleva al epígrafe más próximo para que el
 * balance cuadre y se avisa: esas operaciones obligan a aplicar el PGC (art. 2 del RD 1515/2007) o
 * hay que reclasificarlas.
 */

import type { NodeDefinition, OfficialStatementModelDefinition } from "@/server/accounting/official-statements-model";

const ASSETS: NodeDefinition[] = [
  {
    id: "A", label: "A) ACTIVO NO CORRIENTE", children: [
      { id: "A.I", label: "I. Inmovilizado intangible", accounts: ["20", "280", "290"] },
      { id: "A.II", label: "II. Inmovilizado material", accounts: ["21", "281", "291", "23"] },
      { id: "A.III", label: "III. Inversiones inmobiliarias", accounts: ["22", "282", "292"] },
      { id: "A.IV", label: "IV. Inversiones en empresas del grupo y asociadas a largo plazo", accounts: ["2403", "2404", "2413", "2414", "2423", "2424", "2493", "2494", "2933", "2934", "2943", "2944", "2953", "2954"] },
      { id: "A.V", label: "V. Inversiones financieras a largo plazo", accounts: ["2405", "2415", "2425", "2495", "250", "251", "252", "253", "254", "255", "258", "259", "26", "2935", "2945", "2955", "296", "297", "298"], foreign: ["257", "2936"] },
      { id: "A.VI", label: "VI. Activos por impuesto diferido", accounts: ["474"] },
    ],
  },
  {
    id: "B", label: "B) ACTIVO CORRIENTE", children: [
      { id: "B.I", label: "I. Existencias", accounts: ["30", "31", "32", "33", "34", "35", "36", "39", "407"] },
      {
        id: "B.II", label: "II. Deudores comerciales y otras cuentas a cobrar", children: [
          { id: "B.II.1", label: "1. Clientes por ventas y prestaciones de servicios", accounts: ["430", "431", "432", "433", "434", "435", "436", "437", "490", "493"] },
          { id: "B.II.2", label: "2. Accionistas (socios) por desembolsos exigidos", accounts: ["5580", "5585"] },
          { id: "B.II.3", label: "3. Otros deudores", accounts: ["44", "460", "470", "471", "472", "473", "544"], foreign: ["580", "581", "582", "583", "584", "599"] },
        ],
      },
      { id: "B.III", label: "III. Inversiones en empresas del grupo y asociadas a corto plazo", accounts: ["5303", "5304", "5313", "5314", "5323", "5324", "5333", "5334", "5343", "5344", "5353", "5354", "5393", "5394", "5933", "5934", "5943", "5944", "5953", "5954"], bySign: ["5523", "5524"] },
      { id: "B.IV", label: "IV. Inversiones financieras a corto plazo", accounts: ["5305", "5315", "5325", "5335", "5345", "5355", "5395", "540", "541", "542", "543", "545", "546", "547", "548", "549", "5590", "565", "566", "5935", "5945", "5955", "596", "597", "598"], bySign: ["550", "551", "552", "553", "554", "5525"], foreign: ["5593", "5936"] },
      { id: "B.V", label: "V. Periodificaciones a corto plazo", accounts: ["480", "567"] },
      { id: "B.VI", label: "VI. Efectivo y otros activos líquidos equivalentes", accounts: ["57"] },
    ],
  },
  { id: "TOTAL_ACTIVO", label: "TOTAL ACTIVO (A + B)", totalOf: ["A", "B"] },
];

const EQUITY_AND_LIABILITIES: NodeDefinition[] = [
  {
    id: "PN", label: "A) PATRIMONIO NETO", children: [
      {
        id: "PN.1", label: "A-1) Fondos propios", children: [
          {
            id: "PN.1.I", label: "I. Capital", children: [
              { id: "PN.1.I.1", label: "1. Capital escriturado", accounts: ["100", "101", "102"] },
              { id: "PN.1.I.2", label: "2. (Capital no exigido)", accounts: ["1030", "1040"] },
            ],
          },
          { id: "PN.1.II", label: "II. Prima de emisión", accounts: ["110"] },
          { id: "PN.1.III", label: "III. Reservas", accounts: ["112", "113", "114", "119"], foreign: ["115", "133", "134", "135", "136", "137", "8", "9"] },
          { id: "PN.1.IV", label: "IV. (Acciones y participaciones en patrimonio propias)", accounts: ["108", "109"] },
          { id: "PN.1.V", label: "V. Resultados de ejercicios anteriores", accounts: ["120", "121"] },
          { id: "PN.1.VI", label: "VI. Otras aportaciones de socios", accounts: ["118"], foreign: ["111"] },
          { id: "PN.1.VII", label: "VII. Resultado del ejercicio", accounts: ["129"] },
          { id: "PN.1.VIII", label: "VIII. (Dividendo a cuenta)", accounts: ["557"] },
        ],
      },
      { id: "PN.2", label: "A-2) Subvenciones, donaciones y legados recibidos", accounts: ["130", "131", "132"], foreign: ["84", "94"] },
    ],
  },
  {
    id: "PNC", label: "B) PASIVO NO CORRIENTE", children: [
      { id: "PNC.I", label: "I. Provisiones a largo plazo", accounts: ["14"] },
      {
        id: "PNC.II", label: "II. Deudas a largo plazo", children: [
          { id: "PNC.II.1", label: "1. Deudas con entidades de crédito", accounts: ["1605", "170"] },
          { id: "PNC.II.2", label: "2. Acreedores por arrendamiento financiero", accounts: ["1625", "174"] },
          { id: "PNC.II.3", label: "3. Otras deudas a largo plazo", accounts: ["1615", "1635", "171", "172", "173", "175", "176", "177", "179", "180", "185"], foreign: ["15", "178", "189"] },
        ],
      },
      { id: "PNC.III", label: "III. Deudas con empresas del grupo y asociadas a largo plazo", accounts: ["1603", "1604", "1613", "1614", "1623", "1624", "1633", "1634"] },
      { id: "PNC.IV", label: "IV. Pasivos por impuesto diferido", accounts: ["479"] },
      { id: "PNC.V", label: "V. Periodificaciones a largo plazo", accounts: ["181"] },
    ],
  },
  {
    id: "PC", label: "C) PASIVO CORRIENTE", children: [
      { id: "PC.I", label: "I. Provisiones a corto plazo", accounts: ["499", "529"] },
      {
        id: "PC.II", label: "II. Deudas a corto plazo", children: [
          { id: "PC.II.1", label: "1. Deudas con entidades de crédito", accounts: ["5105", "520", "527"] },
          { id: "PC.II.2", label: "2. Acreedores por arrendamiento financiero", accounts: ["5125", "524"] },
          { id: "PC.II.3", label: "3. Otras deudas a corto plazo", accounts: ["1034", "1044", "190", "192", "194", "500", "505", "506", "509", "5115", "5135", "5145", "521", "522", "523", "525", "526", "528", "555", "5565", "5566", "5595", "560", "561"], bySign: ["550", "551", "552", "553", "554", "5525"], foreign: ["195", "197", "199", "501", "502", "507", "5598", "569", "585", "586", "587", "588", "589"] },
        ],
      },
      { id: "PC.III", label: "III. Deudas con empresas del grupo y asociadas a corto plazo", accounts: ["5103", "5104", "5113", "5114", "5123", "5124", "5133", "5134", "5143", "5144", "5563", "5564"], bySign: ["5523", "5524"] },
      {
        id: "PC.IV", label: "IV. Acreedores comerciales y otras cuentas a pagar", children: [
          { id: "PC.IV.1", label: "1. Proveedores", accounts: ["400", "401", "403", "404", "405", "406"] },
          { id: "PC.IV.2", label: "2. Otros acreedores", accounts: ["41", "438", "465", "466", "475", "476", "477"] },
        ],
      },
      { id: "PC.V", label: "V. Periodificaciones a corto plazo", accounts: ["485", "568"] },
    ],
  },
  { id: "TOTAL_PN_PASIVO", label: "TOTAL PATRIMONIO NETO Y PASIVO (A + B + C)", totalOf: ["PN", "PNC", "PC"] },
];

const OPERATING = ["PG.1", "PG.2", "PG.3", "PG.4", "PG.5", "PG.6", "PG.7", "PG.8", "PG.9", "PG.10", "PG.11", "PG.OTROS"];
const FINANCIAL = ["PG.12", "PG.13", "PG.14", "PG.15", "PG.16"];

const INCOME: NodeDefinition[] = [
  { id: "PG.1", label: "1. Importe neto de la cifra de negocios", accounts: ["700", "701", "702", "703", "704", "705", "706", "708", "709"] },
  { id: "PG.2", label: "2. Variación de existencias de productos terminados y en curso de fabricación", accounts: ["6930", "71", "7930"] },
  { id: "PG.3", label: "3. Trabajos realizados por la empresa para su activo", accounts: ["73"] },
  { id: "PG.4", label: "4. Aprovisionamientos", accounts: ["600", "601", "602", "606", "607", "608", "609", "61", "6931", "6932", "6933", "7931", "7932", "7933"] },
  { id: "PG.5", label: "5. Otros ingresos de explotación", accounts: ["740", "747", "75"] },
  { id: "PG.6", label: "6. Gastos de personal", accounts: ["64"], foreign: ["7950", "7957"] },
  { id: "PG.7", label: "7. Otros gastos de explotación", accounts: ["62", "631", "634", "636", "639", "65", "694", "695", "794", "7954"] },
  { id: "PG.8", label: "8. Amortización del inmovilizado", accounts: ["68"] },
  { id: "PG.9", label: "9. Imputación de subvenciones de inmovilizado no financiero y otras", accounts: ["746"] },
  { id: "PG.10", label: "10. Excesos de provisiones", accounts: ["7951", "7952", "7955"], foreign: ["7956"] },
  { id: "PG.11", label: "11. Deterioro y resultado por enajenaciones del inmovilizado", accounts: ["670", "671", "672", "690", "691", "692", "770", "771", "772", "790", "791", "792"] },
  { id: "PG.OTROS", label: "Otros resultados", accounts: ["678", "778"], foreign: ["774"] },
  { id: "PG.A", label: "A) RESULTADO DE EXPLOTACIÓN", totalOf: OPERATING },
  { id: "PG.12", label: "12. Ingresos financieros", accounts: ["760", "761", "762", "769"], foreign: ["767"] },
  { id: "PG.13", label: "13. Gastos financieros", accounts: ["660", "661", "662", "664", "665", "669"] },
  { id: "PG.14", label: "14. Variación de valor razonable en instrumentos financieros", accounts: ["663", "763"] },
  { id: "PG.15", label: "15. Diferencias de cambio", accounts: ["668", "768"] },
  { id: "PG.16", label: "16. Deterioro y resultado por enajenaciones de instrumentos financieros", accounts: ["666", "667", "673", "675", "696", "697", "698", "699", "766", "773", "775", "796", "797", "798", "799"] },
  { id: "PG.B", label: "B) RESULTADO FINANCIERO (12 + 13 + 14 + 15 + 16)", totalOf: FINANCIAL },
  { id: "PG.C", label: "C) RESULTADO ANTES DE IMPUESTOS (A + B)", totalOf: [...OPERATING, ...FINANCIAL] },
  { id: "PG.17", label: "17. Impuestos sobre beneficios", accounts: ["6300", "6301", "633", "638"] },
  { id: "PG.D", label: "D) RESULTADO DEL EJERCICIO (C + 17)", totalOf: [...OPERATING, ...FINANCIAL, "PG.17"] },
];

export const PYMES_MODEL: OfficialStatementModelDefinition = {
  id: "pymes",
  name: "Modelo de PYMES",
  source: "Plan General de Contabilidad de PYMES (Real Decreto 1515/2007), tercera parte",
  assets: ASSETS,
  equityAndLiabilities: EQUITY_AND_LIABILITIES,
  income: INCOME,
  fallback: { asset: "B.II.3", equityLiability: "PC.II.3", income: "PG.OTROS" },
  yearResultLine: "PN.1.VII",
  priorResultsLine: "PN.1.V",
  totalLines: { assets: "TOTAL_ACTIVO", equityAndLiabilities: "TOTAL_PN_PASIVO", result: "PG.D" },
};
