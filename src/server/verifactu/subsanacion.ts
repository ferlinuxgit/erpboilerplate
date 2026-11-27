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
 * La factura no cambia: importes, número, fecha y DESTINATARIO son los emitidos (los datos del
 * cliente se toman de la copia congelada en la factura, nunca de su ficha actual). Lo único que se
 * vuelve a leer es la razón social de la propia empresa, por si se corrigió tras el rechazo.
 *
 * Si lo que la AEAT rechaza es la identificación del destinatario (NIF o nombre), no hay
 * subsanación posible: esos datos son contenido de la factura y lo que procede es una factura
 * rectificativa (lo comprueba `registerSubsanacionRecord`, igual que los errores no subsanables).
 */
export async function subsanarInvoiceRecord(actor: Actor, invoiceId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, actor.companyId))).limit(1);
    if (!row) throw new HttpError(404, "Factura no encontrada.");
    if (invoiceLifecycle(row) !== "ISSUED") throw new HttpError(409, "Solo se subsanan registros de facturas emitidas.");

    const isCreditNote = row.invoiceType === "CREDIT_NOTE";
    const [lines, currentIssuer] = await Promise.all([
      loadStoredLines(tx, row.id),
      loadIssuerSnapshot(tx, actor.companyId),
    ]);
    const frozenIssuer = row.issuerSnapshot ?? currentIssuer;
    // Destinatario: el congelado al emitir. Solo las facturas anteriores a la congelación de datos
    // (sin copia) recurren a la ficha.
    const customer = row.customerSnapshot ?? await loadCustomerSnapshot(tx, actor.companyId, row.customerId) ?? null;
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
