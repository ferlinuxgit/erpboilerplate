/**
 * Regla para asociar las facturas de alquiler a un inmueble (modelo 180: un registro por inmueble).
 * La regla vive en el propio inmueble (`rental_property.matchAccountCode` y `matchText`) y se aplica a
 * cada línea de factura con retención del arrendador. Función pura.
 *
 * - Subcuenta de gasto: la de la línea tiene que ser exactamente esa (p. ej. 6210001 para el local y
 *   6210002 para el almacén).
 * - Texto: tiene que aparecer en la descripción de la línea o en el número de factura del proveedor,
 *   sin distinguir mayúsculas ni tildes (p. ej. «Calle Mayor 5»).
 * Si un inmueble tiene las dos, se exigen las dos. Un inmueble sin regla no recoge nada por sí solo:
 * las líneas sin inmueble siguen yendo al primero del arrendador, como antes.
 */

export type RentalPropertyRule = { id: string; matchAccountCode: string | null; matchText: string | null };

export type RentalInvoiceLine = { expenseAccountCode: string | null; description: string | null; supplierNumber: string | null };

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function hasRentalRule(rule: Pick<RentalPropertyRule, "matchAccountCode" | "matchText">) {
  return Boolean(rule.matchAccountCode?.trim() || rule.matchText?.trim());
}

/** Inmueble que corresponde a la línea según las reglas; null si ninguno la reclama. */
export function matchRentalProperty(rules: readonly RentalPropertyRule[], line: RentalInvoiceLine): string | null {
  for (const rule of rules) {
    if (!hasRentalRule(rule)) continue;
    const code = rule.matchAccountCode?.trim();
    if (code && (line.expenseAccountCode ?? "") !== code) continue;
    const text = rule.matchText?.trim();
    if (text) {
      const haystack = fold(`${line.description ?? ""} ${line.supplierNumber ?? ""}`);
      if (!haystack.includes(fold(text))) continue;
    }
    return rule.id;
  }
  return null;
}
