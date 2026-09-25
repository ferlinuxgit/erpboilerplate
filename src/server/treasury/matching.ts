import {
  normalizeText,
  toCents,
  type AllocationInput,
  type AllocationType,
} from "@/lib/bank-import/allocations";

export { normalizeText, proposeRuleConcept, resolutionOf, toCents, validateAllocations } from "@/lib/bank-import/allocations";
export type { AllocationInput, AllocationType } from "@/lib/bank-import/allocations";

/**
 * Motor de propuestas de conciliación (funciones puras, sin base de datos).
 *
 * Para cada movimiento pendiente propone, de más a menos probable:
 * - un cobro/pago ya registrado del mismo importe (±3 días) o una remesa SEPA completa;
 * - una o varias facturas abiertas (por importe, número de factura en el concepto o nombre);
 * - una regla del usuario ("concepto contiene X → cuenta").
 *
 * Nada se aplica aquí: son propuestas que el usuario acepta una a una o en bloque ("seguras").
 */

export type MovementForMatching = {
  id: string;
  amount: number;
  description: string;
  reference?: string | null;
  postedAt: Date;
};

export type OpenInvoiceCandidate = {
  id: string;
  kind: "customer" | "supplier";
  number: string;
  /** Número del proveedor (su factura) u otra referencia visible en el extracto. */
  altNumber?: string | null;
  partnerId: string | null;
  partnerName: string;
  outstanding: number;
  dueDate: Date | null;
  issueDate: Date;
};

export type ExistingPaymentCandidate = {
  /** invoicePayment.id o supplierInvoicePayment.id (lo que se concilia). */
  id: string;
  kind: "customer" | "supplier";
  number: string;
  invoiceNumber: string;
  partnerName: string;
  amount: number;
  postedAt: Date;
  remittanceId?: string | null;
  remittanceNumber?: string | null;
};

export type RuleCandidate = {
  id: string;
  name: string;
  conceptContains: string;
  direction: "ANY" | "IN" | "OUT";
  minAmount: number | null;
  maxAmount: number | null;
  accountId: string | null;
  accountLabel: string | null;
  partnerId: string | null;
  partnerName: string | null;
  autoApply: boolean;
};

export type SuggestionKind = "EXISTING_PAYMENT" | "REMITTANCE" | "INVOICE" | "SPLIT" | "RULE";

export type Suggestion = {
  key: string;
  kind: SuggestionKind;
  title: string;
  detail: string;
  score: number;
  confidence: "alta" | "media" | "baja";
  /** Solo la mejor propuesta, con confianza alta y sin rival cercano, se acepta en bloque. */
  safe: boolean;
  ruleId?: string;
  allocations: AllocationInput[];
};

export const SAFE_SCORE = 80;
const SAFE_MARGIN = 15;
const PAYMENT_DAYS_WINDOW = 3;
const REMITTANCE_DAYS_WINDOW = 5;
const MAX_SUBSET_INVOICES = 12;

const STOPWORDS = new Set([
  "sl", "slu", "sa", "sau", "sll", "scp", "cb", "sc", "de", "del", "la", "las", "el", "los", "y", "e", "en",
  "sociedad", "limitada", "anonima", "the", "and", "ltd", "gmbh", "srl", "sas", "cia", "hnos",
]);

/** Solo letras y cifras: "F-2026/0012" → "f20260012". */
export function compactText(value: string | null | undefined) {
  return normalizeText(value).replace(/ /g, "");
}

function centsToNumber(cents: number) {
  return cents / 100;
}

function daysBetween(left: Date, right: Date) {
  return Math.round(Math.abs(left.getTime() - right.getTime()) / 86_400_000);
}

function movementText(movement: MovementForMatching) {
  return `${movement.description} ${movement.reference ?? ""}`;
}

/**
 * ¿Aparece el número del documento en el concepto? Fuerte si aparece entero (≥ 4 caracteres,
 * sin signos); medio si aparece su parte numérica final (≥ 4 cifras) como número suelto.
 */
export function referenceStrength(reference: string | null | undefined, text: string): 0 | 1 | 2 {
  const compactReference = compactText(reference);
  if (compactReference.length < 4) return 0;
  if (compactText(text).includes(compactReference)) return 2;
  // Último grupo de cifras del número ("FAC-2026-4521" → "4521").
  const digits = normalizeText(reference).split(" ").filter((token) => /^\d+$/.test(token)).pop()?.replace(/^0+/, "");
  if (digits && digits.length >= 4) {
    const numbers = normalizeText(text).split(" ").filter((token) => /^\d+$/.test(token)).map((token) => token.replace(/^0+/, ""));
    if (numbers.includes(digits)) return 1;
  }
  return 0;
}

/** Proporción (0-1) de palabras significativas del nombre que aparecen en el concepto. */
export function nameSimilarity(name: string | null | undefined, text: string) {
  const tokens = normalizeText(name).split(" ").filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  if (tokens.length === 0) return 0;
  const words = new Set(normalizeText(text).split(" "));
  const hits = tokens.filter((token) => words.has(token)).length;
  return hits / tokens.length;
}

export function matchRule(rule: Pick<RuleCandidate, "conceptContains" | "direction" | "minAmount" | "maxAmount">, movement: Pick<MovementForMatching, "amount" | "description" | "reference">) {
  const needle = normalizeText(rule.conceptContains);
  if (!needle) return false;
  if (!normalizeText(`${movement.description} ${movement.reference ?? ""}`).includes(needle)) return false;
  if (rule.direction === "IN" && movement.amount < 0) return false;
  if (rule.direction === "OUT" && movement.amount > 0) return false;
  const absolute = Math.abs(movement.amount);
  if (rule.minAmount !== null && absolute < rule.minAmount) return false;
  if (rule.maxAmount !== null && absolute > rule.maxAmount) return false;
  return true;
}

function confidenceOf(score: number): Suggestion["confidence"] {
  if (score >= SAFE_SCORE) return "alta";
  if (score >= 55) return "media";
  return "baja";
}

function allocationTypeFor(kind: "customer" | "supplier", target: "invoice" | "payment"): AllocationType {
  if (target === "invoice") return kind === "customer" ? "CUSTOMER_INVOICE" : "SUPPLIER_INVOICE";
  return kind === "customer" ? "CUSTOMER_PAYMENT" : "SUPPLIER_PAYMENT";
}

function signatureOf(allocations: AllocationInput[]) {
  return allocations.map((allocation) => `${allocation.type}:${allocation.targetId}:${toCents(allocation.amount)}`).sort().join("|");
}

/** Subconjunto (≥ 2 facturas) cuya suma de pendientes es exactamente el importe; el más antiguo primero. */
export function findExactSubset(invoices: OpenInvoiceCandidate[], targetCents: number) {
  const items = [...invoices]
    .sort((a, b) => (a.dueDate ?? a.issueDate).getTime() - (b.dueDate ?? b.issueDate).getTime())
    .slice(0, MAX_SUBSET_INVOICES);
  let best: OpenInvoiceCandidate[] | null = null;
  const total = 1 << items.length;
  for (let mask = 1; mask < total; mask += 1) {
    let sum = 0;
    let count = 0;
    for (let index = 0; index < items.length; index += 1) {
      if (mask & (1 << index)) {
        sum += toCents(items[index].outstanding);
        count += 1;
      }
    }
    if (count >= 2 && sum === targetCents) {
      const subset = items.filter((_, index) => mask & (1 << index));
      // Menos facturas primero; a igualdad, las más antiguas (máscaras bajas = facturas antiguas).
      if (!best || subset.length < best.length) best = subset;
    }
  }
  return best;
}

type RankInput = {
  payments: ExistingPaymentCandidate[];
  invoices: OpenInvoiceCandidate[];
  rules: RuleCandidate[];
};

/** Propuestas para un movimiento, ordenadas de mejor a peor (máximo `limit`). */
export function rankSuggestions(movement: MovementForMatching, input: RankInput, limit = 5): Suggestion[] {
  const kind: "customer" | "supplier" = movement.amount >= 0 ? "customer" : "supplier";
  const targetCents = Math.abs(toCents(movement.amount));
  const text = movementText(movement);
  const suggestions: Suggestion[] = [];
  const exactKeys = new Set<string>();

  const matchedRules = input.rules.filter((rule) => matchRule(rule, movement));
  // Reglas de contrapartida ("concepto contiene X → cliente/proveedor"): sus facturas abiertas se
  // proponen aunque el concepto no traiga el nombre, y la propuesta cuenta como uso de la regla.
  const ruleByPartner = new Map<string, RuleCandidate>();
  for (const rule of matchedRules) if (rule.partnerId && !ruleByPartner.has(rule.partnerId)) ruleByPartner.set(rule.partnerId, rule);
  const rulePartnerIds = new Set(ruleByPartner.keys());
  const ruleFor = (partnerId: string | null) => (partnerId ? ruleByPartner.get(partnerId) : undefined);
  const ruleNote = (partnerId: string | null) => {
    const rule = ruleFor(partnerId);
    return rule ? ` Regla «${rule.name}».` : "";
  };
  const accountRules = matchedRules.filter((rule) => rule.accountId);
  for (const rule of accountRules) {
    suggestions.push({
      key: `rule:${rule.id}`,
      kind: "RULE",
      title: `Asignar a ${rule.accountLabel ?? "la cuenta de la regla"}`,
      detail: `Regla «${rule.name}»: el concepto contiene «${rule.conceptContains}».`,
      score: accountRules.length === 1 ? 88 : 70,
      confidence: confidenceOf(accountRules.length === 1 ? 88 : 70),
      safe: false,
      ruleId: rule.id,
      allocations: [{ type: "ACCOUNT", targetId: rule.accountId as string, amount: centsToNumber(targetCents), label: rule.accountLabel ?? undefined }],
    });
  }

  // Cobros/pagos ya registrados del mismo importe (±3 días).
  const payments = input.payments.filter((payment) => payment.kind === kind);
  for (const payment of payments) {
    if (toCents(payment.amount) !== targetCents) continue;
    const days = daysBetween(payment.postedAt, movement.postedAt);
    if (days > PAYMENT_DAYS_WINDOW) continue;
    const reference = Math.max(referenceStrength(payment.number, text), referenceStrength(payment.invoiceNumber, text));
    const score = 62 + (PAYMENT_DAYS_WINDOW - days) * 4 + (reference === 2 ? 20 : reference === 1 ? 10 : 0) + Math.round(15 * nameSimilarity(payment.partnerName, text));
    const key = `payment:${payment.id}`;
    exactKeys.add(key);
    suggestions.push({
      key,
      kind: "EXISTING_PAYMENT",
      title: `${kind === "customer" ? "Cobro" : "Pago"} ya registrado ${payment.number}`,
      detail: `${payment.partnerName} · factura ${payment.invoiceNumber} · ${days === 0 ? "mismo día" : `${days} ${days === 1 ? "día" : "días"} de diferencia`}.`,
      score,
      confidence: confidenceOf(score),
      safe: false,
      allocations: [{ type: allocationTypeFor(kind, "payment"), targetId: payment.id, amount: centsToNumber(targetCents), label: payment.number }],
    });
  }

  // Remesas SEPA confirmadas (transferencias a proveedores) o cobradas (adeudos a clientes): el
  // banco suele cargar o abonar el total de la remesa en un único apunte.
  const byRemittance = new Map<string, ExistingPaymentCandidate[]>();
  for (const payment of payments) {
    if (!payment.remittanceId) continue;
    byRemittance.set(payment.remittanceId, [...(byRemittance.get(payment.remittanceId) ?? []), payment]);
  }
  for (const [remittanceId, items] of byRemittance) {
    if (items.length < 2) continue;
    const sum = items.reduce((total, item) => total + toCents(item.amount), 0);
    if (sum !== targetCents) continue;
    if (daysBetween(items[0].postedAt, movement.postedAt) > REMITTANCE_DAYS_WINDOW) continue;
    const number = items[0].remittanceNumber ?? "";
    const score = 90 + (referenceStrength(number, text) === 2 ? 5 : 0);
    suggestions.push({
      key: `remittance:${remittanceId}`,
      kind: "REMITTANCE",
      title: `Remesa SEPA ${number}`,
      detail: kind === "customer"
        ? `${items.length} recibos domiciliados cobrados que suman el importe del abono.`
        : `${items.length} pagos a proveedores que suman el importe del cargo.`,
      score,
      confidence: "alta",
      safe: false,
      allocations: items.map((item) => ({ type: allocationTypeFor(kind, "payment"), targetId: item.id, amount: item.amount, label: item.number })),
    });
  }

  // Facturas abiertas: por importe exacto, o parcial si el concepto identifica la factura o al cliente/proveedor.
  const invoices = input.invoices.filter((invoice) => invoice.kind === kind && toCents(invoice.outstanding) > 0);
  const referenced: OpenInvoiceCandidate[] = [];
  for (const invoice of invoices) {
    const reference = Math.max(referenceStrength(invoice.number, text), referenceStrength(invoice.altNumber, text));
    if (reference === 2) referenced.push(invoice);
    const name = invoice.partnerId && rulePartnerIds.has(invoice.partnerId) ? 1 : nameSimilarity(invoice.partnerName, text);
    const outstandingCents = toCents(invoice.outstanding);
    const exact = outstandingCents === targetCents;
    const partial = outstandingCents > targetCents && (reference > 0 || name >= 0.5);
    if (!exact && !partial) continue;
    const dueBonus = invoice.dueDate && daysBetween(invoice.dueDate, movement.postedAt) <= 7 ? 5 : 0;
    const ruleBonus = invoice.partnerId && rulePartnerIds.has(invoice.partnerId) ? 10 : 0;
    const score = (exact ? 50 : 25) + (reference === 2 ? 35 : reference === 1 ? 15 : 0) + Math.round(15 * Math.min(name, 1)) + dueBonus + ruleBonus;
    const key = `invoice:${invoice.id}`;
    if (exact) exactKeys.add(key);
    suggestions.push({
      key,
      kind: "INVOICE",
      title: `${exact ? "" : "Pago parcial de "}${kind === "customer" ? "factura" : "factura de proveedor"} ${invoice.number}`,
      detail: `${invoice.partnerName} · pendiente ${invoice.outstanding.toFixed(2)}${invoice.dueDate ? ` · vence ${invoice.dueDate.toISOString().slice(0, 10)}` : ""}. Se registrará el ${kind === "customer" ? "cobro" : "pago"} con la fecha del movimiento.${ruleNote(invoice.partnerId)}`,
      score,
      confidence: confidenceOf(score),
      safe: false,
      ruleId: ruleFor(invoice.partnerId)?.id,
      allocations: [{ type: allocationTypeFor(kind, "invoice"), targetId: invoice.id, amount: centsToNumber(Math.min(outstandingCents, targetCents)), label: invoice.number }],
    });
  }

  // Varias facturas citadas en el concepto que suman exactamente el importe.
  if (referenced.length >= 2) {
    const sum = referenced.reduce((total, invoice) => total + toCents(invoice.outstanding), 0);
    if (sum === targetCents) {
      const key = `split-ref:${referenced.map((invoice) => invoice.id).join(",")}`;
      exactKeys.add(key);
      suggestions.push({
        key,
        kind: "SPLIT",
        title: `Reparto entre ${referenced.length} facturas citadas en el concepto`,
        detail: referenced.map((invoice) => invoice.number).join(", "),
        score: 92,
        confidence: "alta",
        safe: false,
        allocations: referenced.map((invoice) => ({ type: allocationTypeFor(kind, "invoice"), targetId: invoice.id, amount: invoice.outstanding, label: invoice.number })),
      });
    }
  }

  // Varias facturas del mismo cliente/proveedor (reconocido por el nombre o por una regla).
  const byPartner = new Map<string, OpenInvoiceCandidate[]>();
  for (const invoice of invoices) {
    const partnerKey = invoice.partnerId ?? invoice.partnerName;
    byPartner.set(partnerKey, [...(byPartner.get(partnerKey) ?? []), invoice]);
  }
  for (const [partnerKey, partnerInvoices] of byPartner) {
    const first = partnerInvoices[0];
    const byRule = Boolean(first.partnerId && rulePartnerIds.has(first.partnerId));
    const name = byRule ? 1 : nameSimilarity(first.partnerName, text);
    if (name < 0.5 || partnerInvoices.length < 2) continue;
    const subset = findExactSubset(partnerInvoices, targetCents);
    if (subset) {
      const key = `split:${partnerKey}:${subset.map((invoice) => invoice.id).join(",")}`;
      exactKeys.add(key);
      const score = 60 + Math.round(15 * name);
      suggestions.push({
        key,
        kind: "SPLIT",
        title: `${subset.length} facturas de ${first.partnerName}`,
        detail: `${subset.map((invoice) => invoice.number).join(", ")} suman exactamente el importe.${ruleNote(first.partnerId)}`,
        score,
        confidence: confidenceOf(score),
        safe: false,
        ruleId: ruleFor(first.partnerId)?.id,
        allocations: subset.map((invoice) => ({ type: allocationTypeFor(kind, "invoice"), targetId: invoice.id, amount: invoice.outstanding, label: invoice.number })),
      });
      continue;
    }
    // Sin combinación exacta: se reparte en las más antiguas y la última queda parcial.
    const total = partnerInvoices.reduce((sum, invoice) => sum + toCents(invoice.outstanding), 0);
    if (total < targetCents) continue;
    let remaining = targetCents;
    const allocations: AllocationInput[] = [];
    for (const invoice of [...partnerInvoices].sort((a, b) => (a.dueDate ?? a.issueDate).getTime() - (b.dueDate ?? b.issueDate).getTime())) {
      if (remaining <= 0) break;
      const applied = Math.min(remaining, toCents(invoice.outstanding));
      allocations.push({ type: allocationTypeFor(kind, "invoice"), targetId: invoice.id, amount: centsToNumber(applied), label: invoice.number });
      remaining -= applied;
    }
    if (allocations.length < 2) continue;
    const score = 40 + Math.round(10 * name);
    suggestions.push({
      key: `fifo:${partnerKey}`,
      kind: "SPLIT",
      title: `Repartir entre las facturas más antiguas de ${first.partnerName}`,
      detail: `${allocations.map((allocation) => `${allocation.label} (${allocation.amount.toFixed(2)})`).join(", ")}; la última queda cobrada en parte.${ruleNote(first.partnerId)}`,
      score,
      confidence: confidenceOf(score),
      safe: false,
      ruleId: ruleFor(first.partnerId)?.id,
      allocations,
    });
  }

  // Si solo hay un candidato de importe exacto, gana confianza.
  if (exactKeys.size === 1) {
    const only = suggestions.find((suggestion) => exactKeys.has(suggestion.key));
    if (only) {
      only.score += 10;
      only.confidence = confidenceOf(only.score);
    }
  }

  const unique = new Map<string, Suggestion>();
  for (const suggestion of suggestions) {
    suggestion.score = Math.min(suggestion.score, 99);
    const signature = signatureOf(suggestion.allocations);
    const existing = unique.get(signature);
    if (!existing || existing.score < suggestion.score) unique.set(signature, suggestion);
  }
  const ranked = [...unique.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, limit);
  if (ranked[0] && ranked[0].score >= SAFE_SCORE && (!ranked[1] || ranked[1].score <= ranked[0].score - SAFE_MARGIN)) ranked[0].safe = true;
  return ranked;
}

