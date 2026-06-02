import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { customer, partner } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
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
    .select({ id: partner.id, type: partner.type })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.taxId, values.taxId)))
    .limit(1);

  const partnerId =
    existingPartners[0]?.id ??
    (
      await dbClient
        .insert(partner)
        .values({
          companyId,
          type: "CUSTOMER",
          name: values.name,
          email: values.email,
          phone: values.phone,
          taxId: values.taxId,
          address: values.address,
          addressLine2: values.addressLine2,
          city: values.city,
          province: values.province,
          postalCode: values.postalCode,
          countryCode: values.countryCode,
        })
        .returning({ id: partner.id })
    )[0].id;

  if (existingPartners[0]) {
    await dbClient
      .update(partner)
      .set({
        type: partnerTypeForCustomer(existingPartners[0].type),
        name: values.name,
        email: values.email,
        phone: values.phone,
        taxId: values.taxId,
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

  return createdCustomer;
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
          type: "CUSTOMER",
          name: values.name,
          email: values.email,
          phone: values.phone,
          taxId: values.taxId,
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
