import { and, eq } from "drizzle-orm";

import { company, customer, partner, type InvoicePartySnapshot } from "@/db/schema";
import type { DbClient } from "@/lib/db";

/** Datos fiscales del emisor tal y como constan en la ficha de empresa en el momento de emitir. */
export async function loadIssuerSnapshot(client: DbClient, companyId: string): Promise<InvoicePartySnapshot | null> {
  const [row] = await client
    .select({
      name: company.name,
      legalName: company.legalName,
      vatNumber: company.vatNumber,
      fiscalAddress: company.fiscalAddress,
      fiscalAddressLine2: company.fiscalAddressLine2,
      postalCode: company.postalCode,
      city: company.city,
      province: company.province,
      countryCode: company.countryCode,
      email: company.email,
      phone: company.phone,
      website: company.website,
    })
    .from(company)
    .where(eq(company.id, companyId))
    .limit(1);
  if (!row) return null;
  return {
    name: row.name,
    legalName: row.legalName,
    taxId: row.vatNumber,
    address: row.fiscalAddress,
    addressLine2: row.fiscalAddressLine2,
    postalCode: row.postalCode,
    city: row.city,
    province: row.province,
    countryCode: row.countryCode,
    email: row.email,
    phone: row.phone,
    website: row.website,
  };
}

/** Datos fiscales del cliente (ficha de cliente + tercero) en el momento de emitir. */
export async function loadCustomerSnapshot(client: DbClient, companyId: string, customerId: string): Promise<InvoicePartySnapshot | null> {
  const [row] = await client
    .select({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      number: partner.number,
      partnerName: partner.name,
      taxId: partner.taxId,
      address: partner.address,
      addressLine2: partner.addressLine2,
      postalCode: partner.postalCode,
      city: partner.city,
      province: partner.province,
      countryCode: partner.countryCode,
    })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  return {
    name: row.name,
    legalName: row.partnerName,
    taxId: row.taxId,
    address: row.address,
    addressLine2: row.addressLine2,
    postalCode: row.postalCode,
    city: row.city,
    province: row.province,
    countryCode: row.countryCode ?? "ES",
    number: row.number,
    email: row.email,
    phone: row.phone,
  };
}
