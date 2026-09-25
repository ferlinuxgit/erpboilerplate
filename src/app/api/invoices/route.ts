import { NextResponse } from "next/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { customer, invoice } from "@/db/schema";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { createInvoiceSchema } from "@/server/invoices/schemas";
import { createInvoice } from "@/server/invoices/service";
import { creditedByInvoiceSubquery, invoiceIsIssuedSql, netOutstandingSql, paidByInvoiceSubquery } from "@/server/invoices/sql";
import { getInvoicePdfData } from "@/server/pdf/invoice-pdf";
import { renderInvoicePdf } from "@/server/pdf/render";

export async function GET(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;

  if (!hasApiActorPermission(actor, "invoice.read")) {
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  }

  // ?pending=1: facturas emitidas con algo pendiente de cobro (neto de cobros y rectificativas).
  if (new URL(request.url).searchParams.get("pending") === "1") {
    const companyId = actor.context.company.id;
    const paid = paidByInvoiceSubquery(companyId);
    const credited = creditedByInvoiceSubquery(companyId);
    const outstanding = netOutstandingSql(paid, credited);
    const pendingRows = await db
      .select({
        id: invoice.id,
        number: invoice.number,
        customerName: customer.name,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        totalAmount: invoice.totalAmount,
        paymentStatus: invoice.paymentStatus,
        outstandingAmount: outstanding.mapWith(Number),
      })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .leftJoin(paid, eq(paid.invoiceId, invoice.id))
      .leftJoin(credited, eq(credited.invoiceId, invoice.id))
      .where(and(eq(invoice.companyId, companyId), invoiceIsIssuedSql, eq(invoice.invoiceType, "INVOICE"), sql`${outstanding} > 0`))
      .orderBy(asc(invoice.dueDate), asc(invoice.issueDate))
      .limit(200);
    return NextResponse.json({ data: pendingRows });
  }

  const rows = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      customerId: invoice.customerId,
      customerName: customer.name,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      notes: invoice.notes,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .where(eq(invoice.companyId, actor.context.company.id))
    .orderBy(desc(invoice.createdAt));

  return NextResponse.json({ data: rows });
}

/**
 * Crea una factura. `mode: "draft"` guarda un borrador editable (número provisional, sin asiento);
 * sin `mode` o con `mode: "issue"` se emite directamente (compatibilidad con integraciones).
 */
export async function POST(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;

  if (!hasApiActorPermission(actor, "invoice.create")) {
    return NextResponse.json(
      { message: "No tienes permisos para crear facturas en esta empresa." },
      { status: 403 },
    );
  }

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsedPayload = createInvoiceSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ message: parsedPayload.error.issues[0]?.message ?? "Los datos son inválidos." }, { status: 400 });
  }

  try {
    const createdInvoice = await createInvoice(toInvoiceActor(actor), parsedPayload.data);
    const body = { ...createdInvoice, pdfUrl: `/api/invoices/${createdInvoice.id}/pdf` };

    if (parsedPayload.data.returnPdf) {
      const pdfData = await getInvoicePdfData(actor.context.company.id, createdInvoice.id);
      if (pdfData) {
        const pdf = await renderInvoicePdf(pdfData.input);
        return NextResponse.json(
          {
            ...body,
            pdf: {
              filename: pdfData.filename,
              contentType: "application/pdf",
              encoding: "base64",
              data: Buffer.from(pdf).toString("base64"),
            },
          },
          { status: 201 },
        );
      }
    }

    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    return invoiceErrorResponse(error, "invoice.create", "No se pudo crear la factura.");
  }
}
