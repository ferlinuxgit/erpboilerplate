const PARTNER_NUMBER_WIDTH = 6;

export type PartnerNumberType = "CUSTOMER" | "SUPPLIER" | "BOTH";

const partnerNumberPrefixes: Record<PartnerNumberType, string> = {
  CUSTOMER: "CL",
  SUPPLIER: "PR",
  BOTH: "TE",
};

export function formatPartnerNumber(sequence: number, type: PartnerNumberType) {
  const normalizedSequence = Math.max(1, Math.trunc(sequence));
  return `${partnerNumberPrefixes[type]}${String(normalizedSequence).padStart(PARTNER_NUMBER_WIDTH, "0")}`;
}
