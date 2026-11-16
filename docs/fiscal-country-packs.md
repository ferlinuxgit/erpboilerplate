# Paquetes fiscales por país

Todo lo que cambia de un país a otro se decide a partir del **país de la empresa**
(`company.countryCode`). El usuario no configura impuestos: elige (o se deduce de su NIF) el
país en la puesta en marcha y el resto es automático.

## Niveles

| Nivel | Países | Qué hace |
|---|---|---|
| `full` | España | Plan General Contable, IVA/recargo/IRPF, modelos AEAT (303, 390, 347, 349, 111, 115, 130), calendario, VERI*FACTU, validación de NIF, autónomo/sociedad deducido del NIF. |
| `basic` | Cualquier otro | Tipos de IVA del país (`vat-rates.ts`), plan genérico por grupos (misma numeración que el PGC, nombres neutros), moneda y zona horaria, tratamiento de IVA automático por cliente/proveedor, resumen de impuestos por periodo en `/fiscal`. |

## Canarias, Ceuta y Melilla

Son España (NIF, IRPF, Impuesto sobre Sociedades, VERI*FACTU, modelos 111, 115, 130 y 347) pero
están fuera del territorio del IVA. Su **territorio fiscal** (`ES-CN`, `ES-CE`, `ES-ML`, códigos
ISO 3166-2) se deduce solo del código postal (35/38, 51, 52) o de la provincia, y todo lo que
acepta un código de país acepta también uno de territorio.

| | Canarias (`ES-CN`) | Ceuta (`ES-CE`) / Melilla (`ES-ML`) |
|---|---|---|
| Impuesto | IGIC: 0 %, 3 %, 7 % (por defecto), 9,5 %, 15 % | IPSI (4 % general de servicios por defecto). Ceuta: 10, 9, 6, 4, 2, 1 y 0,5 % (art. 33 de su ordenanza, BOCCE 15-03-2024). Melilla: 10, 8, 4, 2, 1 y 0,5 % (tipos publicados por la Ciudad, 28-01-2026) |
| Recargo de equivalencia, prorrata de IVA, SII, VIES | No | No |
| Modelos 303, 390, 349 | No | No (resumen de IPSI por periodo) |
| Modelos propios | 420 (trimestral), 425 (anual) y 450 (AIEM, si se activa) con sus casillas oficiales | La autoliquidación del IPSI se presenta ante cada ciudad (sin casillas aquí) |
| Regímenes | General, comerciante minorista, pequeño empresario (REPEP) y criterio de caja | — |
| VERI*FACTU | Sí, `Impuesto` = 03 | Sí, `Impuesto` = 02 (sin `ClaveRegimen`) |
| Menciones legales | Ley 20/1991 | Ley 8/1991 |

- Ventas desde la península a estos territorios (o al revés, o desde ellos a la UE): bienes →
  exportación; servicios a empresa → no sujeta; servicios a particular → impuesto del emisor.
  Compras: bienes → importación; servicios → inversión del sujeto pasivo.
- Al cambiar el domicilio (Madrid → Tenerife) la empresa adopta los impuestos del territorio: los
  de mismo tipo se renombran (IVA 4 % → IPSI 4 %) y el resto se desactiva. Se permite aunque haya
  facturas emitidas (es un traslado; las facturas guardan sus propios impuestos).
- Comerciante minorista y REPEP (`src/lib/country-packs/igic.ts`): las ventas se proponen exentas con
  su mención legal (art. 50.Uno.27º y art. 110 Ley 4/2012), el IGIC soportado va a gasto (prorrata 0
  en asientos y resúmenes), sin 420; el 425 lleva el volumen (casillas 143 o 142-147).
- 420 / 425 / 450 (`src/server/fiscal/canarias-calc.ts`) según las instrucciones de la ATC:
  IGIC por tipo en las filas 01-18, inversión del sujeto pasivo 19-20 (75-76 en el 425), deducible
  26-33 (80-87), resultado 45 (95/115) y volumen de operaciones 120-134. Sin compensaciones de
  periodos anteriores, regularizaciones ni complementarias (la ficha del modelo lo advierte).
- AIEM: se activa en Configuración › Fiscalidad; crea los impuestos «AIEM» 5/10/15/25 % (Ley
  4/2014) y el 450. Su cuota se contabiliza hoy junto al IGIC repercutido (477); no hay cuenta propia.
- Pendiente: casillas oficiales de la autoliquidación del IPSI de cada ciudad; régimen simplificado
  del IGIC y del AIEM.

## Piezas

- `src/lib/country-packs/profile.ts` — perfil del país (nivel, moneda, zona horaria, nombre del
  impuesto, capacidades `features.*`). Ligero: se usa en cliente.
- `src/lib/country-packs/index.ts` — `getCountryPack`: perfil + plantilla contable (solo servidor).
- `src/lib/country-packs/vat-rates.ts` — tabla de tipos de IVA (revisada 2026-11).
- `src/lib/country-packs/vat-treatment.ts` — tratamiento de IVA deducido (nacional,
  intracomunitario, exportación, no sujeta, inversión del sujeto pasivo) según país de la
  empresa, país y NIF de la contraparte y qué vende la empresa.
- `src/lib/country-packs/territory.ts` — territorio fiscal (Canarias, Ceuta, Melilla) por código
  postal o provincia.
- `src/lib/country-packs/tax-id.ts` — validación del identificador fiscal por país, país
  deducido del NIF-IVA y tipo de contribuyente español.
- `src/lib/company-templates.ts` — plantilla española y plantilla genérica.
- `src/server/company/country.ts` — cambio de país (solo sin facturas emitidas).
- `src/server/fiscal/tax-summary.ts` — resumen de impuestos de los países `basic`.
- `src/server/fiscal/country-guard.ts` — las pantallas de un país solo existen para sus empresas.

**Regla:** fuera de `country-packs` no se pregunta `countryCode === "ES"`; se pregunta por la
capacidad (`getCountryFiscalProfile(country).features.taxReports`, `.eInvoicing`,
`.equivalenceSurcharge`, `.incomeTaxWithholding`, `usesPgcChart(country)`…).

## Pasar un país a cumplimiento completo

1. Verificar sus tipos en `vat-rates.ts` con la fuente oficial (UE: TEDB).
2. Añadir su entrada en `fullPacks` (`profile.ts`) con sus capacidades. Si una capacidad nueva
   no existe (p. ej. SAF-T en Portugal), añadirla a `CountryFeatures` como unión de valores
   (`taxReports: "es-aeat" | "pt-at"`), nunca como booleano por país.
3. Si tiene plan contable propio, añadir su plantilla en `companyTemplates` y declarar su
   `chartFamily`; si su numeración no es por grupos, revisar los usos de `usesPgcChart`.
4. Colgar sus pantallas (modelos, factura electrónica) de la capacidad, con
   `requireCountryFeaturePage` y el filtro `countryFeature` del menú.
5. Tests: `src/lib/country-packs/country-packs.test.ts` y un test de integración como
   `src/server/company/country.integration.test.ts`.

## Límites conocidos (nivel `basic`)

- Ventas a consumidores de otros países de la UE: se aplica el IVA del país de la empresa (por
  debajo del umbral de 10.000 € de la OSS). La OSS no está implementada.
- Impuesto de ventas de EE. UU. y Brasil: se factura sin impuesto (`Sin impuesto 0%`); necesitan
  un proveedor de cálculo externo.
