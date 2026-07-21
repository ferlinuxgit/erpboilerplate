const PARTNER_NUMBER_PREFIX = "TER-";
const PARTNER_NUMBER_WIDTH = 6;

export function formatPartnerNumber(sequence: number) {
  const normalizedSequence = Math.max(1, Math.trunc(sequence));
  return `${PARTNER_NUMBER_PREFIX}${String(normalizedSequence).padStart(PARTNER_NUMBER_WIDTH, "0")}`;
}
