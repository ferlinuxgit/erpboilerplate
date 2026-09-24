import { NextResponse } from "next/server";

import { hasApiActorPermission, type AuthenticatedApiActor } from "@/lib/integration-auth";
import { handleRouteError, jsonError } from "@/lib/http";
import { CompanyDefaultsMissingError, type InvoiceActor } from "@/server/invoices/service";

/** Adaptadores HTTP compartidos por las rutas de facturas (mantienen los handlers delgados). */

export function toInvoiceActor(actor: AuthenticatedApiActor): InvoiceActor {
  return {
    tenantId: actor.context.tenant.id,
    companyId: actor.context.company.id,
    actorUserId: actor.actorUserId,
    countryCode: actor.context.company.countryCode,
    activeFiscalYearId: actor.context.fiscalYear.id,
    canCreateCustomer: hasApiActorPermission(actor, "customer.create"),
  };
}

export function invoiceErrorResponse(error: unknown, scope: string, fallbackMessage: string) {
  if (error instanceof CompanyDefaultsMissingError) {
    return NextResponse.json(error.status409Payload, { status: 409 });
  }
  const databaseError = error as { code?: string; constraint?: string } | null;
  if (databaseError?.code === "23505" || databaseError?.constraint === "invoice_company_number_unique") {
    return jsonError(409, "El número generado ya existe. Revisa el siguiente número de la serie de facturación en Configuración > Maestros.");
  }
  return handleRouteError(error, scope, fallbackMessage);
}
