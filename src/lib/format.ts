export function formatMoney(value: string | number, currencyCode = "EUR", locale = "es-ES") {
  const amount = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(amount);
}

export function formatDate(value: Date | string, locale = "es-ES") {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
