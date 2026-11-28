import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { renderPayrollReceiptPdf } from "@/server/payroll/receipt-pdf";
import { getSlipReceipt } from "@/server/payroll/service";

/** Recibo de salarios sencillo en PDF con los importes de la nómina (no calcula la nómina). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx } = await requirePermission("accounting.read");
    assertCountryFeature(ctx.company.countryCode, "taxReports");
    const { id } = await params;
    const receipt = await getSlipReceipt(ctx.company.id, id);
    const pdf = await renderPayrollReceiptPdf(receipt);
    const fileName = `recibo-${receipt.periodLabel.replace(/\s+/g, "-")}-${receipt.employee.name}`.normalize("NFD").replace(/[^0-9A-Za-z._-]+/g, "-").slice(0, 120);
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}.pdf"` } });
  } catch (error) {
    return handleRouteError(error, "payroll.slips.receipt", "No se pudo generar el recibo de salarios.");
  }
}
