import { createHash } from "node:crypto";

import type { ImportedMovement } from "@/lib/bank-import/types";
import type { GoCardlessTransaction } from "@/server/bank-connections/gocardless";

/*
 * Conversión de los movimientos de GoCardless al formato de la importación de extractos
 * (funciones puras). Solo se importan los movimientos contabilizados ("booked"): los pendientes
 * pueden cambiar de importe o desaparecer.
 */

export const DEFAULT_ACCESS_DAYS = 90;
export const CONSENT_RENEWAL_WARNING_DAYS = 14;

function dateOnly(value: string | undefined | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function describe(transaction: GoCardlessTransaction) {
  const parts = [
    transaction.remittanceInformationUnstructured,
    ...(transaction.remittanceInformationUnstructuredArray ?? []),
    transaction.remittanceInformationStructured,
    transaction.additionalInformation,
  ].map((part) => part?.replace(/\s+/g, " ").trim()).filter((part): part is string => Boolean(part));
  const counterparty = (Number(transaction.transactionAmount.amount) < 0 ? transaction.creditorName : transaction.debtorName)?.trim();
  const text = [...new Set(parts)].join(" · ");
  const full = counterparty && !text.toLowerCase().includes(counterparty.toLowerCase()) ? [counterparty, text].filter(Boolean).join(" · ") : text;
  return (full || "Movimiento bancario").slice(0, 500);
}

/**
 * Identificador estable del movimiento (clave de deduplicación): el `transactionId` del banco o,
 * si no lo da, `internalTransactionId`/`entryReference`; en último término una huella de los datos.
 */
export function transactionReference(transaction: GoCardlessTransaction) {
  const id = transaction.transactionId?.trim() || transaction.internalTransactionId?.trim() || transaction.entryReference?.trim();
  if (id) return id.slice(0, 200);
  const fingerprint = createHash("sha256")
    .update([transaction.bookingDate, transaction.valueDate, transaction.transactionAmount.amount, describe(transaction), transaction.balanceAfterTransaction?.balanceAmount?.amount ?? ""].join("|"))
    .digest("hex")
    .slice(0, 32);
  return `gc:${fingerprint}`;
}

export function mapBookedTransactions(booked: GoCardlessTransaction[]): { movements: ImportedMovement[]; skipped: number } {
  const movements: ImportedMovement[] = [];
  let skipped = 0;
  booked.forEach((transaction, index) => {
    const postedAt = dateOnly(transaction.bookingDate) ?? dateOnly(transaction.bookingDateTime) ?? dateOnly(transaction.valueDate);
    const amount = Number(transaction.transactionAmount?.amount);
    const currency = transaction.transactionAmount?.currency;
    if (!postedAt || !Number.isFinite(amount) || amount === 0 || (currency && currency !== "EUR")) {
      skipped += 1;
      return;
    }
    const balance = Number(transaction.balanceAfterTransaction?.balanceAmount?.amount);
    movements.push({
      line: index + 1,
      postedAt,
      valueDate: dateOnly(transaction.valueDate),
      amount: Math.round(amount * 100) / 100,
      description: describe(transaction),
      reference: transactionReference(transaction),
      balanceAfter: Number.isFinite(balance) ? balance : null,
    });
  });
  return { movements, skipped };
}

/** Días que le quedan al consentimiento (negativo si ya caducó). */
export function consentDaysLeft(expiresAt: Date | null, now: Date) {
  if (!expiresAt) return null;
  return Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);
}

/** Fecha desde la que pedir movimientos: re-sincroniza 3 días (el banco puede asentar con retraso). */
export function syncDateFrom(input: { now: Date; historyDays: number; lastBookingDate: Date | null; lastOtherSourceDate: Date | null }) {
  const earliest = new Date(input.now.getTime() - input.historyDays * 86_400_000);
  const candidates = [earliest];
  if (input.lastBookingDate) candidates.push(new Date(input.lastBookingDate.getTime() - 3 * 86_400_000));
  // Si ya había movimientos importados de extractos, se empieza al día siguiente para no duplicarlos.
  if (input.lastOtherSourceDate) candidates.push(new Date(input.lastOtherSourceDate.getTime() + 86_400_000));
  const from = new Date(Math.max(...candidates.map((date) => date.getTime())));
  return from.toISOString().slice(0, 10);
}

/** Estados de la requisition de GoCardless → estado de la conexión. */
export function connectionStatusFromRequisition(status: string): "PENDING" | "LINKED" | "EXPIRED" | "REVOKED" | "ERROR" {
  switch (status) {
    case "LN":
      return "LINKED";
    case "EX":
      return "EXPIRED";
    case "RJ":
    case "SU":
      return "REVOKED";
    case "CR":
    case "GC":
    case "UA":
    case "GA":
    case "SA":
      return "PENDING";
    default:
      return "ERROR";
  }
}
