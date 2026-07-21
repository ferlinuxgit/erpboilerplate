import { and, eq } from "drizzle-orm";

import {
  company,
  partner,
  purchaseOrder,
  purchaseOrderLine,
} from "@/db/schema";
import { db } from "@/lib/db";
import { statusLabel, purchaseOrderStatusLabels } from "@/lib/status-labels";
import type { PurchaseOrderPdfInput } from "@/server/pdf/render";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short" }).format(value);
}

function formatMoney(value: number | string, currency: string) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(
    Number(value) || 0,
  );
}

function formatDecimal(value: number | string) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(
    Number(value) || 0,
  );
}

export async function getPurchaseOrderPdfData(
  companyId: string,
  id: string,
): Promise<{ input: PurchaseOrderPdfInput; filename: string } | null> {
  const [record] = await db
    .select({
      number: purchaseOrder.number,
      status: purchaseOrder.status,
      createdAt: purchaseOrder.createdAt,
      currency: company.baseCurrencyCode,
      companyName: company.name,
      companyLegalName: company.legalName,
      companyVatNumber: company.vatNumber,
      companyAddress: company.fiscalAddress,
      companyPostalCode: company.postalCode,
      companyCity: company.city,
      companyProvince: company.province,
      companyCountryCode: company.countryCode,
      supplierNumber: partner.number,
      supplierName: partner.name,
      supplierTaxId: partner.taxId,
      supplierAddress: partner.address,
      supplierPostalCode: partner.postalCode,
      supplierCity: partner.city,
      supplierProvince: partner.province,
      supplierCountryCode: partner.countryCode,
      supplierEmail: partner.email,
    })
    .from(purchaseOrder)
    .innerJoin(company, eq(company.id, purchaseOrder.companyId))
    .innerJoin(partner, eq(partner.id, purchaseOrder.supplierPartnerId))
    .where(
      and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, companyId)),
    )
    .limit(1);

  if (!record) return null;

  const lines = await db
    .select()
    .from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.purchaseOrderId, id));
  const total = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0);

  return {
    filename: `pedido-${record.number.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`,
    input: {
      number: record.number,
      createdAt: formatDate(record.createdAt),
      status: statusLabel(purchaseOrderStatusLabels, record.status),
      total: formatMoney(total, record.currency),
      company: {
        name: record.companyName,
        legalName: record.companyLegalName,
        vatNumber: record.companyVatNumber,
        address: record.companyAddress,
        postalCode: record.companyPostalCode,
        city: record.companyCity,
        province: record.companyProvince,
        countryCode: record.companyCountryCode,
      },
      supplier: {
        number: record.supplierNumber,
        name: record.supplierName,
        taxId: record.supplierTaxId,
        address: record.supplierAddress,
        postalCode: record.supplierPostalCode,
        city: record.supplierCity,
        province: record.supplierProvince,
        countryCode: record.supplierCountryCode,
        email: record.supplierEmail,
      },
      lines: lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: formatDecimal(line.quantity),
        unitPrice: formatMoney(line.unitPrice, record.currency),
        lineTotal: formatMoney(line.lineTotal, record.currency),
      })),
    },
  };
}
