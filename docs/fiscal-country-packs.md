# Paquetes fiscales por país

Todo lo que cambia de un país a otro se decide a partir del **país de la empresa**
(`company.countryCode`). El usuario no configura impuestos: elige (o se deduce de su NIF) el
país en la puesta en marcha y el resto es automático.

## Niveles

| Nivel | Países | Qué hace |
|---|---|---|
| `full` | España | Plan General Contable, IVA/recargo/IRPF, modelos AEAT (303, 390, 347, 349, 111, 115, 130), calendario, VERI*FACTU, validación de NIF, autónomo/sociedad deducido del NIF. |
| `basic` | Cualquier otro | Tipos de IVA del país (`vat-rates.ts`), plan genérico por grupos (misma numeración que el PGC, nombres neutros), moneda y zona horaria, tratamiento de IVA automático por cliente/proveedor, resumen de impuestos por periodo en `/fiscal`. |

## Piezas

- `src/lib/country-packs/profile.ts` — perfil del país (nivel, moneda, zona horaria, nombre del
  impuesto, capacidades `features.*`). Ligero: se usa en cliente.
- `src/lib/country-packs/index.ts` — `getCountryPack`: perfil + plantilla contable (solo servidor).
- `src/lib/country-packs/vat-rates.ts` — tabla de tipos de IVA (revisada 2026-11).
- `src/lib/country-packs/vat-treatment.ts` — tratamiento de IVA deducido (nacional,
  intracomunitario, exportación, no sujeta, inversión del sujeto pasivo) según país de la
  empresa, país y NIF de la contraparte y qué vende la empresa.
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
- Canarias, Ceuta y Melilla no se distinguen del resto de España.
