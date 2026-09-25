import { checkIban, isValidBic, normalizeBic, normalizeIban } from "@/lib/bank-import/iban";
import { checkCreditorId, normalizeCreditorId } from "@/lib/bank-import/sepa-creditor";
import { amountText, escapeXml, isoDate, isoDateTime, sepaId, sepaText } from "@/server/sepa/pain001";

/**
 * Fichero de adeudos directos SEPA (ISO 20022 pain.008.001.02, esquema CORE), el que aceptan los
 * bancos españoles para las remesas de recibos domiciliados (antiguo cuaderno 19). Función pura.
 *
 * Un bloque <PmtInf> por tipo de secuencia (FRST, RCUR, OOFF, FNAL): los bancos lo exigen porque
 * cada secuencia tiene sus propios plazos de presentación.
 */

export const PAIN008_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.008.001.02";

export type SequenceType = "FRST" | "RCUR" | "OOFF" | "FNAL";
export const SEQUENCE_TYPES: SequenceType[] = ["FRST", "RCUR", "OOFF", "FNAL"];

export const sequenceTypeLabels: Record<SequenceType, string> = {
  FRST: "Primer adeudo",
  RCUR: "Recurrente",
  OOFF: "Único",
  FNAL: "Último adeudo",
};

export type Pain008Debit = {
  endToEndId: string;
  amount: number;
  sequenceType: SequenceType;
  mandateReference: string;
  mandateSignatureDate: Date;
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  remittanceInformation: string;
};

export type Pain008Input = {
  messageId: string;
  createdAt: Date;
  collectionDate: Date;
  creditor: { name: string; creditorId: string; iban: string; bic?: string | null };
  debits: Pain008Debit[];
};

/** Errores (en lenguaje llano) que impiden generar el fichero. */
export function validatePain008Input(input: Pain008Input) {
  const errors: string[] = [];
  if (!sepaId(input.messageId)) errors.push("Falta el identificador de la remesa.");
  if (!sepaText(input.creditor.name, 70)) errors.push("Falta el nombre de la empresa acreedora.");
  const creditorId = checkCreditorId(input.creditor.creditorId);
  if (!creditorId.valid) errors.push(`Identificador de acreedor SEPA: ${creditorId.reason}`);
  const creditorIban = checkIban(input.creditor.iban);
  if (!creditorIban.valid) errors.push(`IBAN de la cuenta de abono: ${creditorIban.reason}`);
  if (input.creditor.bic && !isValidBic(input.creditor.bic)) errors.push("El BIC de la cuenta de abono no es válido (8 u 11 caracteres).");
  if (Number.isNaN(input.collectionDate.getTime())) errors.push("La fecha de cobro no es válida.");
  if (input.debits.length === 0) errors.push("Selecciona al menos una factura.");
  const seen = new Set<string>();
  input.debits.forEach((debit, index) => {
    const label = `Recibo ${index + 1} (${debit.debtorName || "sin nombre"})`;
    const cents = Math.round(debit.amount * 100);
    if (!Number.isFinite(cents) || cents <= 0) errors.push(`${label}: el importe debe ser mayor que 0.`);
    if (cents > 99_999_999_999) errors.push(`${label}: importe demasiado alto.`);
    const iban = checkIban(debit.debtorIban);
    if (!iban.valid) errors.push(`${label}: ${iban.reason}`);
    if (debit.debtorBic && !isValidBic(debit.debtorBic)) errors.push(`${label}: el BIC no es válido.`);
    if (!sepaText(debit.debtorName, 70)) errors.push(`${label}: falta el nombre del deudor.`);
    if (!sepaId(debit.mandateReference)) errors.push(`${label}: falta la referencia del mandato.`);
    if (Number.isNaN(debit.mandateSignatureDate.getTime())) errors.push(`${label}: la fecha de firma del mandato no es válida.`);
    else if (debit.mandateSignatureDate.getTime() > input.collectionDate.getTime()) errors.push(`${label}: el mandato se firmó después de la fecha de cobro.`);
    if (!SEQUENCE_TYPES.includes(debit.sequenceType)) errors.push(`${label}: tipo de adeudo desconocido.`);
    const id = sepaId(debit.endToEndId);
    if (!id) errors.push(`${label}: falta la referencia del recibo.`);
    if (seen.has(id)) errors.push(`${label}: referencia repetida (${id}).`);
    seen.add(id);
  });
  return errors;
}

function agentLines(indent: string, bic: string | null | undefined) {
  const normalized = bic ? normalizeBic(bic) : null;
  return [
    `${indent}<FinInstnId>`,
    ...(normalized ? [`${indent}  <BIC>${normalized}</BIC>`] : [`${indent}  <Othr>`, `${indent}    <Id>NOTPROVIDED</Id>`, `${indent}  </Othr>`]),
    `${indent}</FinInstnId>`,
  ];
}

export function buildPain008(input: Pain008Input) {
  const errors = validatePain008Input(input);
  if (errors.length > 0) throw new Error(errors.join(" "));

  const debits = input.debits.map((debit) => ({ ...debit, cents: Math.round(debit.amount * 100) }));
  const totalCents = debits.reduce((sum, debit) => sum + debit.cents, 0);
  const messageId = sepaId(input.messageId);
  const creditorName = escapeXml(sepaText(input.creditor.name, 70));
  const creditorId = normalizeCreditorId(input.creditor.creditorId);

  const lines: string[] = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<Document xmlns="${PAIN008_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    "  <CstmrDrctDbtInitn>",
    "    <GrpHdr>",
    `      <MsgId>${escapeXml(messageId)}</MsgId>`,
    `      <CreDtTm>${isoDateTime(input.createdAt)}</CreDtTm>`,
    `      <NbOfTxs>${debits.length}</NbOfTxs>`,
    `      <CtrlSum>${amountText(totalCents)}</CtrlSum>`,
    "      <InitgPty>",
    `        <Nm>${creditorName}</Nm>`,
    "        <Id>",
    "          <OrgId>",
    "            <Othr>",
    `              <Id>${escapeXml(creditorId)}</Id>`,
    "            </Othr>",
    "          </OrgId>",
    "        </Id>",
    "      </InitgPty>",
    "    </GrpHdr>",
  ];

  for (const sequenceType of SEQUENCE_TYPES) {
    const group = debits.filter((debit) => debit.sequenceType === sequenceType);
    if (group.length === 0) continue;
    const groupCents = group.reduce((sum, debit) => sum + debit.cents, 0);
    lines.push(
      "    <PmtInf>",
      `      <PmtInfId>${escapeXml(sepaId(`${messageId}-${sequenceType}`))}</PmtInfId>`,
      "      <PmtMtd>DD</PmtMtd>",
      "      <BtchBookg>true</BtchBookg>",
      `      <NbOfTxs>${group.length}</NbOfTxs>`,
      `      <CtrlSum>${amountText(groupCents)}</CtrlSum>`,
      "      <PmtTpInf>",
      "        <SvcLvl>",
      "          <Cd>SEPA</Cd>",
      "        </SvcLvl>",
      "        <LclInstrm>",
      "          <Cd>CORE</Cd>",
      "        </LclInstrm>",
      `        <SeqTp>${sequenceType}</SeqTp>`,
      "      </PmtTpInf>",
      `      <ReqdColltnDt>${isoDate(input.collectionDate)}</ReqdColltnDt>`,
      "      <Cdtr>",
      `        <Nm>${creditorName}</Nm>`,
      "      </Cdtr>",
      "      <CdtrAcct>",
      "        <Id>",
      `          <IBAN>${normalizeIban(input.creditor.iban)}</IBAN>`,
      "        </Id>",
      "        <Ccy>EUR</Ccy>",
      "      </CdtrAcct>",
      "      <CdtrAgt>",
      ...agentLines("        ", input.creditor.bic),
      "      </CdtrAgt>",
      "      <ChrgBr>SLEV</ChrgBr>",
      "      <CdtrSchmeId>",
      "        <Id>",
      "          <PrvtId>",
      "            <Othr>",
      `              <Id>${escapeXml(creditorId)}</Id>`,
      "              <SchmeNm>",
      "                <Prtry>SEPA</Prtry>",
      "              </SchmeNm>",
      "            </Othr>",
      "          </PrvtId>",
      "        </Id>",
      "      </CdtrSchmeId>",
    );
    for (const debit of group) {
      lines.push(
        "      <DrctDbtTxInf>",
        "        <PmtId>",
        `          <EndToEndId>${escapeXml(sepaId(debit.endToEndId))}</EndToEndId>`,
        "        </PmtId>",
        `        <InstdAmt Ccy="EUR">${amountText(debit.cents)}</InstdAmt>`,
        "        <DrctDbtTx>",
        "          <MndtRltdInf>",
        `            <MndtId>${escapeXml(sepaId(debit.mandateReference))}</MndtId>`,
        `            <DtOfSgntr>${isoDate(debit.mandateSignatureDate)}</DtOfSgntr>`,
        "          </MndtRltdInf>",
        "        </DrctDbtTx>",
        "        <DbtrAgt>",
        ...agentLines("          ", debit.debtorBic),
        "        </DbtrAgt>",
        "        <Dbtr>",
        `          <Nm>${escapeXml(sepaText(debit.debtorName, 70))}</Nm>`,
        "        </Dbtr>",
        "        <DbtrAcct>",
        "          <Id>",
        `            <IBAN>${normalizeIban(debit.debtorIban)}</IBAN>`,
        "          </Id>",
        "        </DbtrAcct>",
        "        <RmtInf>",
        `          <Ustrd>${escapeXml(sepaText(debit.remittanceInformation, 140) || "Recibo")}</Ustrd>`,
        "        </RmtInf>",
        "      </DrctDbtTxInf>",
      );
    }
    lines.push("    </PmtInf>");
  }
  lines.push("  </CstmrDrctDbtInitn>", "</Document>", "");
  return lines.join("\n");
}
