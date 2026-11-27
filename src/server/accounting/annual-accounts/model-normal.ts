/**
 * Balance y cuenta de pérdidas y ganancias en el MODELO NORMAL del Plan General de Contabilidad
 * (Real Decreto 1514/2007, tercera parte, «Modelos normales de cuentas anuales»).
 *
 * El reparto de cuentas por partida es el de la columna «N.º cuentas» del BOE (BOE-A-2007-19884,
 * texto consolidado con el RD 602/2016 y el RD 1/2021). Lo que la tabla oficial no prevé:
 * - Dentro de cada epígrafe con partidas, las cuentas del subgrupo que la tabla no cita van a la
 *   partida «Otro…/Otros…» del epígrafe (200 investigación y sus correctoras → «Otro inmovilizado
 *   intangible»; 257 → «Otros activos financieros»; 1341, 135 y 136 → ajustes «Otros»; 15, 195-199,
 *   502 y 507 → «Otros pasivos financieros»; resto de 470 y 475 → otros créditos y otras deudas con
 *   las Administraciones Públicas).
 * - 473 (retenciones y pagos a cuenta) → «Otros créditos con las Administraciones Públicas».
 * - 2935/2936 y 5935/5936 (RD 1/2021) siguen a sus participaciones, que no son de empresas del
 *   grupo: instrumentos de patrimonio de las inversiones financieras.
 * - 5585 acompaña a la 5580; 550, 552, 553 y 554 se tratan como la 551 (activo o pasivo según el saldo).
 * - 678, 778 y 774 → «Otros resultados», dentro del resultado de explotación (la tabla no les da partida).
 * - Grupos 8 y 9 sin traspasar → la partida de ajustes por cambios de valor a la que se traspasan
 *   (800/802/89/900/902/99 → I; 81/91 → II; resto → III; 84 y 94 → subvenciones).
 * - Las partidas sin cuentas en la tabla («Derivados» y «Otros activos financieros» en empresas del
 *   grupo, operaciones interrumpidas) se muestran a cero.
 *
 * Las subcuentas se asignan por su código: 76000000 es «7600» (dividendos de empresas del grupo) y
 * 47090000 es «4709» (activo por impuesto corriente). Quien use el modelo normal debe llevar esas
 * cuentas con el desglose de cuatro dígitos del plan.
 */

import type { NodeDefinition, OfficialStatementModelDefinition } from "@/server/accounting/official-statements-model";

const ASSETS: NodeDefinition[] = [
  {
    id: "A", label: "A) ACTIVO NO CORRIENTE", children: [
      {
        id: "A.I", label: "I. Inmovilizado intangible", children: [
          { id: "A.I.1", label: "1. Desarrollo", accounts: ["201", "2801", "2901"] },
          { id: "A.I.2", label: "2. Concesiones", accounts: ["202", "2802", "2902"] },
          { id: "A.I.3", label: "3. Patentes, licencias, marcas y similares", accounts: ["203", "2803", "2903"] },
          { id: "A.I.4", label: "4. Fondo de comercio", accounts: ["204", "2804"] },
          { id: "A.I.5", label: "5. Aplicaciones informáticas", accounts: ["206", "2806", "2906"] },
          { id: "A.I.6", label: "6. Otro inmovilizado intangible", accounts: ["205", "209", "2805", "2905", "20", "280", "290"] },
        ],
      },
      {
        id: "A.II", label: "II. Inmovilizado material", children: [
          { id: "A.II.1", label: "1. Terrenos y construcciones", accounts: ["210", "211", "2811", "2910", "2911"] },
          { id: "A.II.2", label: "2. Instalaciones técnicas y otro inmovilizado material", accounts: ["212", "213", "214", "215", "216", "217", "218", "219", "2812", "2813", "2814", "2815", "2816", "2817", "2818", "2819", "2912", "2913", "2914", "2915", "2916", "2917", "2918", "2919", "21", "281", "291"] },
          { id: "A.II.3", label: "3. Inmovilizado en curso y anticipos", accounts: ["23"] },
        ],
      },
      {
        id: "A.III", label: "III. Inversiones inmobiliarias", children: [
          { id: "A.III.1", label: "1. Terrenos", accounts: ["220", "2920"] },
          { id: "A.III.2", label: "2. Construcciones", accounts: ["221", "282", "2921", "22", "292"] },
        ],
      },
      {
        id: "A.IV", label: "IV. Inversiones en empresas del grupo y asociadas a largo plazo", children: [
          { id: "A.IV.1", label: "1. Instrumentos de patrimonio", accounts: ["2403", "2404", "2493", "2494", "293"] },
          { id: "A.IV.2", label: "2. Créditos a empresas", accounts: ["2423", "2424", "2953", "2954"] },
          { id: "A.IV.3", label: "3. Valores representativos de deuda", accounts: ["2413", "2414", "2943", "2944"] },
          { id: "A.IV.4", label: "4. Derivados" },
          { id: "A.IV.5", label: "5. Otros activos financieros" },
        ],
      },
      {
        id: "A.V", label: "V. Inversiones financieras a largo plazo", children: [
          { id: "A.V.1", label: "1. Instrumentos de patrimonio", accounts: ["2405", "2495", "250", "259", "2935", "2936"] },
          { id: "A.V.2", label: "2. Créditos a terceros", accounts: ["2425", "252", "253", "254", "2955", "298"] },
          { id: "A.V.3", label: "3. Valores representativos de deuda", accounts: ["2415", "251", "2945", "297"] },
          { id: "A.V.4", label: "4. Derivados", accounts: ["255"] },
          { id: "A.V.5", label: "5. Otros activos financieros", accounts: ["258", "26", "257"] },
        ],
      },
      { id: "A.VI", label: "VI. Activos por impuesto diferido", accounts: ["474"] },
    ],
  },
  {
    id: "B", label: "B) ACTIVO CORRIENTE", children: [
      { id: "B.I", label: "I. Activos no corrientes mantenidos para la venta", accounts: ["580", "581", "582", "583", "584", "599"] },
      {
        id: "B.II", label: "II. Existencias", children: [
          { id: "B.II.1", label: "1. Comerciales", accounts: ["30", "390"] },
          { id: "B.II.2", label: "2. Materias primas y otros aprovisionamientos", accounts: ["31", "32", "391", "392"] },
          { id: "B.II.3", label: "3. Productos en curso", accounts: ["33", "34", "393", "394"] },
          { id: "B.II.4", label: "4. Productos terminados", accounts: ["35", "395"] },
          { id: "B.II.5", label: "5. Subproductos, residuos y materiales recuperados", accounts: ["36", "396"] },
          { id: "B.II.6", label: "6. Anticipos a proveedores", accounts: ["407"] },
        ],
      },
      {
        id: "B.III", label: "III. Deudores comerciales y otras cuentas a cobrar", children: [
          { id: "B.III.1", label: "1. Clientes por ventas y prestaciones de servicios", accounts: ["430", "431", "432", "435", "436", "437", "490", "4935", "493"] },
          { id: "B.III.2", label: "2. Clientes, empresas del grupo y asociadas", accounts: ["433", "434", "4933", "4934"] },
          { id: "B.III.3", label: "3. Deudores varios", accounts: ["44"] },
          { id: "B.III.4", label: "4. Personal", accounts: ["460", "544"] },
          { id: "B.III.5", label: "5. Activos por impuesto corriente", accounts: ["4709"] },
          { id: "B.III.6", label: "6. Otros créditos con las Administraciones Públicas", accounts: ["4700", "4708", "471", "472", "470", "473"] },
          { id: "B.III.7", label: "7. Accionistas (socios) por desembolsos exigidos", accounts: ["5580", "5585"] },
        ],
      },
      {
        id: "B.IV", label: "IV. Inversiones en empresas del grupo y asociadas a corto plazo", children: [
          { id: "B.IV.1", label: "1. Instrumentos de patrimonio", accounts: ["5303", "5304", "5393", "5394", "593"] },
          { id: "B.IV.2", label: "2. Créditos a empresas", accounts: ["5323", "5324", "5343", "5344", "5953", "5954"] },
          { id: "B.IV.3", label: "3. Valores representativos de deuda", accounts: ["5313", "5314", "5333", "5334", "5943", "5944"] },
          { id: "B.IV.4", label: "4. Derivados" },
          { id: "B.IV.5", label: "5. Otros activos financieros", accounts: ["5353", "5354"], bySign: ["5523", "5524"] },
        ],
      },
      {
        id: "B.V", label: "V. Inversiones financieras a corto plazo", children: [
          { id: "B.V.1", label: "1. Instrumentos de patrimonio", accounts: ["5305", "540", "5395", "549", "5935", "5936"] },
          { id: "B.V.2", label: "2. Créditos a empresas", accounts: ["5325", "5345", "542", "543", "547", "5955", "598"] },
          { id: "B.V.3", label: "3. Valores representativos de deuda", accounts: ["5315", "5335", "541", "546", "5945", "597"] },
          { id: "B.V.4", label: "4. Derivados", accounts: ["5590", "5593"] },
          { id: "B.V.5", label: "5. Otros activos financieros", accounts: ["5355", "545", "548", "565", "566"], bySign: ["550", "551", "552", "553", "554", "5525"] },
        ],
      },
      { id: "B.VI", label: "VI. Periodificaciones a corto plazo", accounts: ["480", "567"] },
      {
        id: "B.VII", label: "VII. Efectivo y otros activos líquidos equivalentes", children: [
          { id: "B.VII.1", label: "1. Tesorería", accounts: ["570", "571", "572", "573", "574", "575", "57"] },
          { id: "B.VII.2", label: "2. Otros activos líquidos equivalentes", accounts: ["576"] },
        ],
      },
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
          {
            id: "PN.1.III", label: "III. Reservas", children: [
              { id: "PN.1.III.1", label: "1. Legal y estatutarias", accounts: ["112", "1141"] },
              { id: "PN.1.III.2", label: "2. Otras reservas", accounts: ["113", "1140", "1142", "1143", "1144", "115", "119", "114"] },
            ],
          },
          { id: "PN.1.IV", label: "IV. (Acciones y participaciones en patrimonio propias)", accounts: ["108", "109"] },
          {
            id: "PN.1.V", label: "V. Resultados de ejercicios anteriores", children: [
              { id: "PN.1.V.1", label: "1. Remanente", accounts: ["120"] },
              { id: "PN.1.V.2", label: "2. (Resultados negativos de ejercicios anteriores)", accounts: ["121"] },
            ],
          },
          { id: "PN.1.VI", label: "VI. Otras aportaciones de socios", accounts: ["118"] },
          { id: "PN.1.VII", label: "VII. Resultado del ejercicio", accounts: ["129"] },
          { id: "PN.1.VIII", label: "VIII. (Dividendo a cuenta)", accounts: ["557"] },
          { id: "PN.1.IX", label: "IX. Otros instrumentos de patrimonio neto", accounts: ["111"] },
        ],
      },
      {
        id: "PN.2", label: "A-2) Ajustes por cambios de valor", children: [
          { id: "PN.2.I", label: "I. Activos financieros a valor razonable con cambios en el patrimonio neto", accounts: ["133", "800", "802", "89", "900", "902", "99"] },
          { id: "PN.2.II", label: "II. Operaciones de cobertura", accounts: ["1340", "81", "91"] },
          { id: "PN.2.III", label: "III. Otros", accounts: ["137", "134", "135", "136", "8", "9"] },
        ],
      },
      { id: "PN.3", label: "A-3) Subvenciones, donaciones y legados recibidos", accounts: ["130", "131", "132", "84", "94"] },
    ],
  },
  {
    id: "PNC", label: "B) PASIVO NO CORRIENTE", children: [
      {
        id: "PNC.I", label: "I. Provisiones a largo plazo", children: [
          { id: "PNC.I.1", label: "1. Obligaciones por prestaciones a largo plazo al personal", accounts: ["140"] },
          { id: "PNC.I.2", label: "2. Actuaciones medioambientales", accounts: ["145"] },
          { id: "PNC.I.3", label: "3. Provisiones por reestructuración", accounts: ["146"] },
          { id: "PNC.I.4", label: "4. Otras provisiones", accounts: ["141", "142", "143", "147", "14"] },
        ],
      },
      {
        id: "PNC.II", label: "II. Deudas a largo plazo", children: [
          { id: "PNC.II.1", label: "1. Obligaciones y otros valores negociables", accounts: ["177", "178", "179"] },
          { id: "PNC.II.2", label: "2. Deudas con entidades de crédito", accounts: ["1605", "170"] },
          { id: "PNC.II.3", label: "3. Acreedores por arrendamiento financiero", accounts: ["1625", "174"] },
          { id: "PNC.II.4", label: "4. Derivados", accounts: ["176"] },
          { id: "PNC.II.5", label: "5. Otros pasivos financieros", accounts: ["1615", "1635", "171", "172", "173", "175", "180", "185", "189", "15"] },
        ],
      },
      { id: "PNC.III", label: "III. Deudas con empresas del grupo y asociadas a largo plazo", accounts: ["1603", "1604", "1613", "1614", "1623", "1624", "1633", "1634"] },
      { id: "PNC.IV", label: "IV. Pasivos por impuesto diferido", accounts: ["479"] },
      { id: "PNC.V", label: "V. Periodificaciones a largo plazo", accounts: ["181"] },
    ],
  },
  {
    id: "PC", label: "C) PASIVO CORRIENTE", children: [
      { id: "PC.I", label: "I. Pasivos vinculados con activos no corrientes mantenidos para la venta", accounts: ["585", "586", "587", "588", "589"] },
      { id: "PC.II", label: "II. Provisiones a corto plazo", accounts: ["499", "529"] },
      {
        id: "PC.III", label: "III. Deudas a corto plazo", children: [
          { id: "PC.III.1", label: "1. Obligaciones y otros valores negociables", accounts: ["500", "501", "505", "506"] },
          { id: "PC.III.2", label: "2. Deudas con entidades de crédito", accounts: ["5105", "520", "527"] },
          { id: "PC.III.3", label: "3. Acreedores por arrendamiento financiero", accounts: ["5125", "524"] },
          { id: "PC.III.4", label: "4. Derivados", accounts: ["5595", "5598"] },
          { id: "PC.III.5", label: "5. Otros pasivos financieros", accounts: ["1034", "1044", "190", "192", "194", "509", "5115", "5135", "5145", "521", "522", "523", "525", "526", "528", "555", "5565", "5566", "560", "561", "569", "195", "197", "199", "502", "507"], bySign: ["550", "551", "552", "553", "554", "5525"] },
        ],
      },
      { id: "PC.IV", label: "IV. Deudas con empresas del grupo y asociadas a corto plazo", accounts: ["5103", "5104", "5113", "5114", "5123", "5124", "5133", "5134", "5143", "5144", "5563", "5564"], bySign: ["5523", "5524"] },
      {
        id: "PC.V", label: "V. Acreedores comerciales y otras cuentas a pagar", children: [
          { id: "PC.V.1", label: "1. Proveedores", accounts: ["400", "401", "405", "406"] },
          { id: "PC.V.2", label: "2. Proveedores, empresas del grupo y asociadas", accounts: ["403", "404"] },
          { id: "PC.V.3", label: "3. Acreedores varios", accounts: ["41"] },
          { id: "PC.V.4", label: "4. Personal (remuneraciones pendientes de pago)", accounts: ["465", "466"] },
          { id: "PC.V.5", label: "5. Pasivos por impuesto corriente", accounts: ["4752"] },
          { id: "PC.V.6", label: "6. Otras deudas con las Administraciones Públicas", accounts: ["4750", "4751", "4758", "476", "477", "475"] },
          { id: "PC.V.7", label: "7. Anticipos de clientes", accounts: ["438"] },
        ],
      },
      { id: "PC.VI", label: "VI. Periodificaciones a corto plazo", accounts: ["485", "568"] },
    ],
  },
  { id: "TOTAL_PN_PASIVO", label: "TOTAL PATRIMONIO NETO Y PASIVO (A + B + C)", totalOf: ["PN", "PNC", "PC"] },
];

const OPERATING = ["PG.1", "PG.2", "PG.3", "PG.4", "PG.5", "PG.6", "PG.7", "PG.8", "PG.9", "PG.10", "PG.11", "PG.OTROS"];
const FINANCIAL = ["PG.12", "PG.13", "PG.14", "PG.15", "PG.16"];
const CONTINUING = [...OPERATING, ...FINANCIAL, "PG.17"];

const INCOME: NodeDefinition[] = [
  {
    id: "PG.1", label: "1. Importe neto de la cifra de negocios", children: [
      { id: "PG.1.a", label: "a) Ventas", accounts: ["700", "701", "702", "703", "704", "706", "708", "709"] },
      { id: "PG.1.b", label: "b) Prestaciones de servicios", accounts: ["705"] },
    ],
  },
  { id: "PG.2", label: "2. Variación de existencias de productos terminados y en curso de fabricación", accounts: ["6930", "71", "7930"] },
  { id: "PG.3", label: "3. Trabajos realizados por la empresa para su activo", accounts: ["73"] },
  {
    id: "PG.4", label: "4. Aprovisionamientos", children: [
      { id: "PG.4.a", label: "a) Consumo de mercaderías", accounts: ["600", "6060", "6080", "6090", "610", "606", "608", "609", "61"] },
      { id: "PG.4.b", label: "b) Consumo de materias primas y otras materias consumibles", accounts: ["601", "602", "6061", "6062", "6081", "6082", "6091", "6092", "611", "612"] },
      { id: "PG.4.c", label: "c) Trabajos realizados por otras empresas", accounts: ["607"] },
      { id: "PG.4.d", label: "d) Deterioro de mercaderías, materias primas y otros aprovisionamientos", accounts: ["6931", "6932", "6933", "7931", "7932", "7933"] },
    ],
  },
  {
    id: "PG.5", label: "5. Otros ingresos de explotación", children: [
      { id: "PG.5.a", label: "a) Ingresos accesorios y otros de gestión corriente", accounts: ["75"] },
      { id: "PG.5.b", label: "b) Subvenciones de explotación incorporadas al resultado del ejercicio", accounts: ["740", "747"] },
    ],
  },
  {
    id: "PG.6", label: "6. Gastos de personal", children: [
      { id: "PG.6.a", label: "a) Sueldos, salarios y asimilados", accounts: ["640", "641", "6450", "645"] },
      { id: "PG.6.b", label: "b) Cargas sociales", accounts: ["642", "643", "649", "64"] },
      { id: "PG.6.c", label: "c) Provisiones", accounts: ["644", "6457", "7950", "7957"] },
    ],
  },
  {
    id: "PG.7", label: "7. Otros gastos de explotación", children: [
      { id: "PG.7.a", label: "a) Servicios exteriores", accounts: ["62"] },
      { id: "PG.7.b", label: "b) Tributos", accounts: ["631", "634", "636", "639"] },
      { id: "PG.7.c", label: "c) Pérdidas, deterioro y variación de provisiones por operaciones comerciales", accounts: ["650", "694", "695", "794", "7954"] },
      { id: "PG.7.d", label: "d) Otros gastos de gestión corriente", accounts: ["651", "659", "65"] },
    ],
  },
  { id: "PG.8", label: "8. Amortización del inmovilizado", accounts: ["68"] },
  { id: "PG.9", label: "9. Imputación de subvenciones de inmovilizado no financiero y otras", accounts: ["746"] },
  { id: "PG.10", label: "10. Excesos de provisiones", accounts: ["7951", "7952", "7955", "7956"] },
  {
    id: "PG.11", label: "11. Deterioro y resultado por enajenaciones del inmovilizado", children: [
      { id: "PG.11.a", label: "a) Deterioros y pérdidas", accounts: ["690", "691", "692", "790", "791", "792"] },
      { id: "PG.11.b", label: "b) Resultados por enajenaciones y otras", accounts: ["670", "671", "672", "770", "771", "772"] },
    ],
  },
  { id: "PG.OTROS", label: "Otros resultados", accounts: ["678", "774", "778"] },
  { id: "PG.A1", label: "A.1) RESULTADO DE EXPLOTACIÓN", totalOf: OPERATING },
  {
    id: "PG.12", label: "12. Ingresos financieros", children: [
      {
        id: "PG.12.a", label: "a) De participaciones en instrumentos de patrimonio", children: [
          { id: "PG.12.a1", label: "a1) En empresas del grupo y asociadas", accounts: ["7600", "7601"] },
          { id: "PG.12.a2", label: "a2) En terceros", accounts: ["7602", "7603", "760"] },
        ],
      },
      {
        id: "PG.12.b", label: "b) De valores negociables y otros instrumentos financieros", children: [
          { id: "PG.12.b1", label: "b1) De empresas del grupo y asociadas", accounts: ["7610", "7611", "76200", "76201", "76210", "76211"] },
          { id: "PG.12.b2", label: "b2) De terceros", accounts: ["7612", "7613", "76202", "76203", "76212", "76213", "767", "769", "761", "762"] },
        ],
      },
    ],
  },
  {
    id: "PG.13", label: "13. Gastos financieros", children: [
      { id: "PG.13.a", label: "a) Por deudas con empresas del grupo y asociadas", accounts: ["6610", "6611", "6615", "6616", "6620", "6621", "6640", "6641", "6650", "6651", "6654", "6655"] },
      { id: "PG.13.b", label: "b) Por deudas con terceros", accounts: ["6612", "6613", "6617", "6618", "6622", "6623", "6624", "6642", "6643", "6652", "6653", "6656", "6657", "669", "661", "662", "664", "665"] },
      { id: "PG.13.c", label: "c) Por actualización de provisiones", accounts: ["660"] },
    ],
  },
  {
    id: "PG.14", label: "14. Variación de valor razonable en instrumentos financieros", children: [
      { id: "PG.14.a", label: "a) Valor razonable con cambios en pérdidas y ganancias", accounts: ["6630", "6631", "6633", "7630", "7631", "7633", "663", "763"] },
      { id: "PG.14.b", label: "b) Transferencia de ajustes de valor razonable con cambios en el patrimonio neto", accounts: ["6632", "7632"] },
    ],
  },
  { id: "PG.15", label: "15. Diferencias de cambio", accounts: ["668", "768"] },
  {
    id: "PG.16", label: "16. Deterioro y resultado por enajenaciones de instrumentos financieros", children: [
      { id: "PG.16.a", label: "a) Deterioros y pérdidas", accounts: ["696", "697", "698", "699", "796", "797", "798", "799"] },
      { id: "PG.16.b", label: "b) Resultados por enajenaciones y otras", accounts: ["666", "667", "673", "675", "766", "773", "775"] },
    ],
  },
  { id: "PG.A2", label: "A.2) RESULTADO FINANCIERO (12 + 13 + 14 + 15 + 16)", totalOf: FINANCIAL },
  { id: "PG.A3", label: "A.3) RESULTADO ANTES DE IMPUESTOS (A.1 + A.2)", totalOf: [...OPERATING, ...FINANCIAL] },
  { id: "PG.17", label: "17. Impuestos sobre beneficios", accounts: ["6300", "6301", "633", "638"] },
  { id: "PG.A4", label: "A.4) RESULTADO DEL EJERCICIO PROCEDENTE DE OPERACIONES CONTINUADAS (A.3 + 17)", totalOf: CONTINUING },
  { id: "PG.18", label: "18. Resultado del ejercicio procedente de operaciones interrumpidas neto de impuestos" },
  { id: "PG.A5", label: "A.5) RESULTADO DEL EJERCICIO (A.4 + 18)", totalOf: [...CONTINUING, "PG.18"] },
];

export const NORMAL_MODEL: OfficialStatementModelDefinition = {
  id: "normal",
  name: "Modelo normal",
  source: "Plan General de Contabilidad (Real Decreto 1514/2007), tercera parte",
  assets: ASSETS,
  equityAndLiabilities: EQUITY_AND_LIABILITIES,
  income: INCOME,
  fallback: { asset: "B.III.3", equityLiability: "PC.III.5", income: "PG.OTROS" },
  yearResultLine: "PN.1.VII",
  priorResultsLine: { profit: "PN.1.V.1", loss: "PN.1.V.2" },
  totalLines: { assets: "TOTAL_ACTIVO", equityAndLiabilities: "TOTAL_PN_PASIVO", result: "PG.A5" },
};
