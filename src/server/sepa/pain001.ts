import { checkIban, isValidBic, normalizeBic, normalizeIban } from "@/lib/bank-import/iban";

/**
 * Fichero de transferencias SEPA (ISO 20022 pain.001.001.03, "SEPA Credit Transfer"), el que
 * aceptan todos los bancos españoles para remesas de pagos a proveedores. Función pura.
 */

export const PAIN001_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03";

export type Pain001Transfer = {
  endToEndId: string;
  amount: number;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  remittanceInformation: string;
};

export type Pain001Input = {
  messageId: string;
  createdAt: Date;
  executionDate: Date;
  debtor: { name: string; taxId?: string | null; iban: string; bic?: string | null };
  transfers: Pain001Transfer[];
};

/** Juego de caracteres SEPA básico: letras sin tilde, cifras y / - ? : ( ) . , ' + espacio. */
export function sepaText(value: string, maxLength: number) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[ñÑ]/g, (letter) => (letter === "ñ" ? "n" : "N"))
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Identificador SEPA (MsgId, PmtInfId, EndToEndId): máx. 35, sin espacios. */
export function sepaId(value: string) {
  return sepaText(value, 35).replace(/ /g, "");
}

export function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function isoDateTime(date: Date) {
  return date.toISOString().slice(0, 19);
}

export function amountText(cents: number) {
  return (cents / 100).toFixed(2);
}

/** Errores (en lenguaje llano) que impiden generar el fichero. */
export function validatePain001Input(input: Pain001Input) {
  const errors: string[] = [];
  if (!sepaId(input.messageId)) errors.push("Falta el identificador de la remesa.");
  if (!sepaText(input.debtor.name, 70)) errors.push("Falta el nombre de la empresa ordenante.");
  const debtorIban = checkIban(input.debtor.iban);
  if (!debtorIban.valid) errors.push(`IBAN de la cuenta de cargo: ${debtorIban.reason}`);
  if (input.debtor.bic && !isValidBic(input.debtor.bic)) errors.push("El BIC de la cuenta de cargo no es válido (8 u 11 caracteres).");
  if (input.transfers.length === 0) errors.push("Selecciona al menos una factura.");
  const seen = new Set<string>();
  input.transfers.forEach((transfer, index) => {
    const label = `Pago ${index + 1} (${transfer.creditorName || "sin nombre"})`;
    const cents = Math.round(transfer.amount * 100);
    if (!Number.isFinite(cents) || cents <= 0) errors.push(`${label}: el importe debe ser mayor que 0.`);
    if (cents > 99_999_999_999) errors.push(`${label}: importe demasiado alto.`);
    const iban = checkIban(transfer.creditorIban);
    if (!iban.valid) errors.push(`${label}: ${iban.reason}`);
    if (transfer.creditorBic && !isValidBic(transfer.creditorBic)) errors.push(`${label}: el BIC no es válido.`);
    if (!sepaText(transfer.creditorName, 70)) errors.push(`${label}: falta el nombre del beneficiario.`);
    const id = sepaId(transfer.endToEndId);
    if (!id) errors.push(`${label}: falta la referencia del pago.`);
    if (seen.has(id)) errors.push(`${label}: referencia repetida (${id}).`);
    seen.add(id);
  });
  return errors;
}

export function buildPain001(input: Pain001Input) {
  const errors = validatePain001Input(input);
  if (errors.length > 0) throw new Error(errors.join(" "));

  const transfers = input.transfers.map((transfer) => ({ ...transfer, cents: Math.round(transfer.amount * 100) }));
  const totalCents = transfers.reduce((sum, transfer) => sum + transfer.cents, 0);
  const count = String(transfers.length);
  const messageId = sepaId(input.messageId);
  const debtorName = escapeXml(sepaText(input.debtor.name, 70));
  const debtorBic = input.debtor.bic ? normalizeBic(input.debtor.bic) : null;
  const taxId = input.debtor.taxId ? sepaId(input.debtor.taxId) : "";

  const lines: string[] = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<Document xmlns="${PAIN001_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    "  <CstmrCdtTrfInitn>",
    "    <GrpHdr>",
    `      <MsgId>${escapeXml(messageId)}</MsgId>`,
    `      <CreDtTm>${isoDateTime(input.createdAt)}</CreDtTm>`,
    `      <NbOfTxs>${count}</NbOfTxs>`,
    `      <CtrlSum>${amountText(totalCents)}</CtrlSum>`,
    "      <InitgPty>",
    `        <Nm>${debtorName}</Nm>`,
    ...(taxId ? ["        <Id>", "          <OrgId>", "            <Othr>", `              <Id>${escapeXml(taxId)}</Id>`, "            </Othr>", "          </OrgId>", "        </Id>"] : []),
    "      </InitgPty>",
    "    </GrpHdr>",
    "    <PmtInf>",
    `      <PmtInfId>${escapeXml(sepaId(`${messageId}-1`))}</PmtInfId>`,
    "      <PmtMtd>TRF</PmtMtd>",
    "      <BtchBookg>true</BtchBookg>",
    `      <NbOfTxs>${count}</NbOfTxs>`,
    `      <CtrlSum>${amountText(totalCents)}</CtrlSum>`,
    "      <PmtTpInf>",
    "        <SvcLvl>",
    "          <Cd>SEPA</Cd>",
    "        </SvcLvl>",
    "      </PmtTpInf>",
    `      <ReqdExctnDt>${isoDate(input.executionDate)}</ReqdExctnDt>`,
    "      <Dbtr>",
    `        <Nm>${debtorName}</Nm>`,
    "      </Dbtr>",
    "      <DbtrAcct>",
    "        <Id>",
    `          <IBAN>${normalizeIban(input.debtor.iban)}</IBAN>`,
    "        </Id>",
    "        <Ccy>EUR</Ccy>",
    "      </DbtrAcct>",
    "      <DbtrAgt>",
    "        <FinInstnId>",
    ...(debtorBic ? [`          <BIC>${debtorBic}</BIC>`] : ["          <Othr>", "            <Id>NOTPROVIDED</Id>", "          </Othr>"]),
    "        </FinInstnId>",
    "      </DbtrAgt>",
    "      <ChrgBr>SLEV</ChrgBr>",
  ];
  for (const transfer of transfers) {
    lines.push(
      "      <CdtTrfTxInf>",
      "        <PmtId>",
      `          <EndToEndId>${escapeXml(sepaId(transfer.endToEndId))}</EndToEndId>`,
      "        </PmtId>",
      "        <Amt>",
      `          <InstdAmt Ccy="EUR">${amountText(transfer.cents)}</InstdAmt>`,
      "        </Amt>",
      ...(transfer.creditorBic ? ["        <CdtrAgt>", "          <FinInstnId>", `            <BIC>${normalizeBic(transfer.creditorBic)}</BIC>`, "          </FinInstnId>", "        </CdtrAgt>"] : []),
      "        <Cdtr>",
      `          <Nm>${escapeXml(sepaText(transfer.creditorName, 70))}</Nm>`,
      "        </Cdtr>",
      "        <CdtrAcct>",
      "          <Id>",
      `            <IBAN>${normalizeIban(transfer.creditorIban)}</IBAN>`,
      "          </Id>",
      "        </CdtrAcct>",
      "        <RmtInf>",
      `          <Ustrd>${escapeXml(sepaText(transfer.remittanceInformation, 140) || "Pago factura")}</Ustrd>`,
      "        </RmtInf>",
      "      </CdtTrfTxInf>",
    );
  }
  lines.push("    </PmtInf>", "  </CstmrCdtTrfInitn>", "</Document>", "");
  return lines.join("\n");
}
