import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { customer, partner } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { normalizeTaxIdentity } from "@/lib/expense-dedup";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { reservePartnerNumber } from "@/server/partners/numbers";
import { createCustomerSchema, updateCustomerSchema } from "@/server/schemas/forms";

type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

function cleanOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeCountryCode(value: string | null | undefined) {
  return (value?.trim() || "ES").toUpperCase();
}

function fiscalValues(input: CreateCustomerInput | UpdateCustomerInput) {
  return {
    name: input.name.trim(),
    email: cleanOptional(input.email),
    phone: cleanOptional(input.phone),
    taxId: normalizeSpanishTaxId(input.taxId),
    taxIdNormalized: normalizeTaxIdentity(input.taxId, input.countryCode),
    address: input.address.trim(),
    addressLine2: cleanOptional(input.addressLine2),
    city: input.city.trim(),
    province: input.province.trim(),
    postalCode: input.postalCode.trim(),
    countryCode: normalizeCountryCode(input.countryCode),
  };
}

function partnerTypeForCustomer(currentType: "CUSTOMER" | "SUPPLIER" | "BOTH") {
  return currentType === "SUPPLIER" ? "BOTH" : currentType;
}

export async function createCustomerWithPartner(dbClient: DbClient, companyId: string, input: CreateCustomerInput) {
  const values = fiscalValues(input);
  const existingPartners = await dbClient
    .select({ id: partner.id, number: partner.number, type: partner.type })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.countryCode, values.countryCode), eq(partner.taxIdNormalized, values.taxIdNormalized)))
    .limit(1);

  const partnerRecord = existingPartners[0] ?? (
    await dbClient
      .insert(partner)
      .values({
        companyId,
        number: await reservePartnerNumber(dbClient, companyId),
        type: "CUSTOMER",
        name: values.name,
        email: values.email,
        phone: values.phone,
        taxId: values.taxId,
        taxIdNormalized: values.taxIdNormalized,
        address: values.address,
        addressLine2: values.addressLine2,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        countryCode: values.countryCode,
      })
      .returning({ id: partner.id, number: partner.number, type: partner.type })
  )[0];
  const partnerId = partnerRecord.id;

  if (existingPartners[0]) {
    await dbClient
      .update(partner)
      .set({
        type: partnerTypeForCustomer(existingPartners[0].type),
        name: values.name,
        email: values.email,
        phone: values.phone,
        taxId: values.taxId,
        taxIdNormalized: values.taxIdNormalized,
        address: values.address,
        addressLine2: values.addressLine2,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        countryCode: values.countryCode,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(and(eq(partner.id, partnerId), eq(partner.companyId, companyId)));
  }

  const [createdCustomer] = await dbClient
    .insert(customer)
    .values({
      name: values.name,
      email: values.email,
      phone: values.phone,
      companyId,
      partnerId,
    })
    .returning({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      partnerId: customer.partnerId,
    });

  return { ...createdCustomer, number: partnerRecord.number };
}

export async function updateCustomerWithPartner(
  dbClient: DbClient,
  companyId: string,
  customerId: string,
  currentPartnerId: string | null,
  input: UpdateCustomerInput,
) {
  const values = fiscalValues(input);
  let partnerId = currentPartnerId;

  if (partnerId) {
    const existingPartners = await dbClient
      .select({ type: partner.type })
      .from(partner)
      .where(and(eq(partner.id, partnerId), eq(partner.companyId, companyId)))
      .limit(1);

    await dbClient
      .update(partner)
      .set({
        type: existingPartners[0] ? partnerTypeForCustomer(existingPartners[0].type) : "CUSTOMER",
        name: values.name,
        email: values.email,
        phone: values.phone,
        taxId: values.taxId,
        taxIdNormalized: values.taxIdNormalized,
        address: values.address,
        addressLine2: values.addressLine2,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        countryCode: values.countryCode,
        isActive: input.status !== "INACTIVE",
        updatedAt: new Date(),
      })
      .where(and(eq(partner.id, partnerId), eq(partner.companyId, companyId)));
  } else {
    partnerId = (
      await dbClient
        .insert(partner)
        .values({
          companyId,
          number: await reservePartnerNumber(dbClient, companyId),
          type: "CUSTOMER",
          name: values.name,
          email: values.email,
          phone: values.phone,
          taxId: values.taxId,
          taxIdNormalized: values.taxIdNormalized,
          address: values.address,
          addressLine2: values.addressLine2,
          city: values.city,
          province: values.province,
          postalCode: values.postalCode,
          countryCode: values.countryCode,
          isActive: input.status !== "INACTIVE",
        })
        .returning({ id: partner.id })
    )[0].id;
  }

  const [updatedCustomer] = await dbClient
    .update(customer)
    .set({
      name: values.name,
      email: values.email,
      phone: values.phone,
      status: input.status ?? "ACTIVE",
      partnerId,
      updatedAt: new Date(),
    })
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId)))
    .returning();

  return updatedCustomer;
}
