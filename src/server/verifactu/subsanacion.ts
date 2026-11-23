import { and, eq } from "drizzle-orm";

import { invoice } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { recordAudit } from "@/server/audit";
import { customerDefaultVatTreatment, invoiceLifecycle, verifactuSalesVatTreatment, type SalesVatTreatmentCode } from "@/server/invoices/lifecycle";
import { loadStoredLines } from "@/server/invoices/service";
import { loadCustomerSnapshot, loadIssuerSnapshot } from "@/server/invoices/snapshot";
import { appendEvent } from "@/server/verifactu/chain";
import { registerSubsanacionRecord } from "@/server/verifactu/hooks";

type Actor = { tenantId: string; companyId: string; actorUserId: string };

/**
 * Subsana el registro VERI*FACTU de una factura emitida que la AEAT rechazó o aceptó con errores.
 *
 * La factura no cambia (importes, número y fecha son los emitidos). Lo que se vuelve a leer son los
 * datos identificativos que provocan casi todos los rechazos: el NIF y el nombre del cliente y la
 * razón social de la empresa, tal y como estén ahora en sus fichas. El flujo es: corregir la ficha
 * y pulsar «Subsanar»; el registro nuevo se envía con el siguiente lote.
 */
export async function subsanarInvoiceRecord(actor: Actor, invoiceId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, actor.companyId))).limit(1);
    if (!row) throw new HttpError(404, "Factura no encontrada.");
    if (invoiceLifecycle(row) !== "ISSUED") throw new HttpError(409, "Solo se subsanan registros de facturas emitidas.");

    const isCreditNote = row.invoiceType === "CREDIT_NOTE";
    const [lines, currentIssuer, currentCustomer] = await Promise.all([
      loadStoredLines(tx, row.id),
      loadIssuerSnapshot(tx, actor.companyId),
      loadCustomerSnapshot(tx, actor.companyId, row.customerId),
    ]);
    const frozenIssuer = row.issuerSnapshot ?? currentIssuer;
    const customer = currentCustomer ?? row.customerSnapshot ?? null;
    if (!frozenIssuer) throw new HttpError(404, "Empresa no encontrada.");
    const totals = calculateInvoiceTotals(lines, { allowNegative: isCreditNote });

    let original: { id: string; number: string; issueDate: Date } | null = null;
    if (row.rectifiedInvoiceId) {
      const [found] = await tx
        .select({ id: invoice.id, number: invoice.number, issueDate: invoice.issueDate })
        .from(invoice)
        .where(and(eq(invoice.id, row.rectifiedInvoiceId), eq(invoice.companyId, actor.companyId)))
        .limit(1);
      original = found ?? null;
    }

    const vatTreatment = (row.vatTreatment as SalesVatTreatmentCode | null)
      ?? customerDefaultVatTreatment({ countryCode: customer?.countryCode, taxId: customer?.taxId });
    const record = await registerSubsanacionRecord(tx, {
      companyId: actor.companyId,
      invoiceId: row.id,
      number: row.number,
      issueDate: row.issueDate,
      invoiceType: row.invoiceType,
      rectificationReason: row.rectificationReason,
      rectificationDescription: row.rectificationDescription,
      vatTreatment: verifactuSalesVatTreatment(vatTreatment),
      // El NIF emisor identifica la factura y no cambia; el nombre sí puede haberse corregido.
      issuer: { ...frozenIssuer, name: currentIssuer?.name ?? frozenIssuer.name, legalName: currentIssuer?.legalName ?? frozenIssuer.legalName },
      customer,
      totals,
      lineDescriptions: lines.map((line) => line.description ?? ""),
      original,
      operationDate: row.operationDate,
      exemptionCode: row.vatExemptionCode,
    });

    await appendEvent(tx, {
      companyId: actor.companyId,
      eventType: "SUBSANACION",
      description: `Subsanación del registro de la factura ${record.invoiceNumber} (registro n.º ${record.sequence}).`,
      payload: { invoiceId: row.id, sequence: record.sequence, rechazoPrevio: record.rechazoPrevio },
      actorUserId: actor.actorUserId,
    });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "verifactu.subsanacion",
      entityName: "invoice",
      entityId: row.id,
      payload: { number: record.invoiceNumber, verifactuRecordId: record.id, rechazoPrevio: record.rechazoPrevio },
    }, tx);
    return { sequence: record.sequence, invoiceNumber: record.invoiceNumber };
  });
}
