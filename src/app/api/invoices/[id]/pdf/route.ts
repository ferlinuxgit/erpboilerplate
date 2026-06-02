import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { company, customer, invoice, partner } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import { renderInvoicePdf } from "@/server/pdf/render";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { id } = await params;

  const rows = await db
    .select({
      number: invoice.number,
      amount: invoice.totalAmount,
      companyName: company.name,
      companyLegalName: company.legalName,
      companyVatNumber: company.vatNumber,
      customerName: customer.name,
      customerTaxId: partner.taxId,
      customerAddress: partner.address,
      customerAddressLine2: partner.addressLine2,
      customerPostalCode: partner.postalCode,
      customerCity: partner.city,
      customerProvince: partner.province,
      customerCountryCode: partner.countryCode,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .innerJoin(company, eq(company.id, invoice.companyId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
    .limit(1);
  if (!rows[0]) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });

  const pdf = await renderInvoicePdf({
    number: rows[0].number,
    amount: rows[0].amount.toString(),
    company: {
      name: rows[0].companyName,
      legalName: rows[0].companyLegalName,
      vatNumber: rows[0].companyVatNumber,
    },
    customer: {
      name: rows[0].customerName,
      taxId: rows[0].customerTaxId,
      address: rows[0].customerAddress,
      addressLine2: rows[0].customerAddressLine2,
      postalCode: rows[0].customerPostalCode,
      city: rows[0].customerCity,
      province: rows[0].customerProvince,
      countryCode: rows[0].customerCountryCode,
    },
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${rows[0].number}.pdf"`,
    },
  });
}
