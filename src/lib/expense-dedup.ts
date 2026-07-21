export function normalizeSupplierDocumentNumber(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeTaxIdentity(value: string | null | undefined, countryCode?: string | null) {
  const normalized = (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const country = (countryCode ?? "").trim().toUpperCase();
  return country && normalized.startsWith(country) && normalized.length - country.length >= 6
    ? normalized.slice(country.length)
    : normalized;
}

export function normalizeSupplierName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function buildSupplierIdentityKey(input: {
  partnerId: string;
  countryCode?: string | null;
  taxId?: string | null;
  name?: string | null;
}) {
  const countryCode = (input.countryCode?.trim() || "ES").toUpperCase();
  const taxId = normalizeTaxIdentity(input.taxId, countryCode);
  if (!taxId) {
    const name = normalizeSupplierName(input.name);
    return name ? `name:${countryCode}:${name}` : `partner:${input.partnerId}`;
  }
  return `tax:${countryCode}:${taxId}`;
}
