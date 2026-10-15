import { NextResponse } from "next/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { company, customer, invoice } from "@/db/schema";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { parseListParams } from "@/lib/list-params";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { createInvoiceSchema } from "@/server/invoices/schemas";
import { createInvoice } from "@/server/invoices/service";
import { creditedByInvoiceSubquery, invoiceIsIssuedSql, netOutstandingSql, paidByInvoiceSubquery } from "@/server/invoices/sql";
import { getInvoicePdf } from "@/server/invoices/stored-pdf";
import { invoiceListConfig, listInvoicesForExport } from "@/server/invoices/list";

export async function GET(request: Request) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;

  if (!hasApiActorPermission(actor, "invoice.read")) {
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  }

  // ?export=all: todas las facturas del filtro del listado (?q=&from=&to=&status=&due=&type=&sort=&dir=)
  // con Base, IVA e IRPF, para exportarlas completas.
  const url = new URL(request.url);
  if (url.searchParams.get("export") === "all") {
    try {
      const params = parseListParams(Object.fromEntries(url.searchParams), invoiceListConfig);
      const [companyRow] = await db.select({ timezone: company.timezone }).from(company).where(eq(company.id, actor.context.company.id)).limit(1);
      return NextResponse.json(await listInvoicesForExport(actor.context.company.id, params, {
        timezone: companyRow?.timezone || undefined,
        currencyCode: actor.context.company.baseCurrencyCode,
      }));
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudieron exportar las facturas." }, { status: 422 });
    }
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
      const pdf = await getInvoicePdf(actor.context.company.id, createdInvoice.id);
      if (pdf) {
        return NextResponse.json(
          {
            ...body,
            pdf: {
              filename: pdf.fileName,
              contentType: "application/pdf",
              encoding: "base64",
              data: pdf.bytes.toString("base64"),
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
