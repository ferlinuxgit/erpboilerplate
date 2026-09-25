import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EditCustomerForm } from "@/components/customers/edit-customer-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, partner } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { isCustomerDunningOptedOut } from "@/server/dunning/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const session = await requireUserSession();
    const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
    const { id } = await params;
    const [row] = await db
      .select({ name: customer.name })
      .from(customer)
      .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Editar cliente ${row.name}` : "Editar cliente" };
  } catch {
    return { title: "Editar cliente" };
  }
}

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { id } = await params;
  const rows = await db
    .select({
      id: customer.id,
      number: partner.number,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      taxId: partner.taxId,
      address: partner.address,
      addressLine2: partner.addressLine2,
      postalCode: partner.postalCode,
      city: partner.city,
      province: partner.province,
      countryCode: partner.countryCode,
      paymentTermsDays: partner.paymentTermsDays,
      defaultRetentionRate: customer.defaultRetentionRate,
      defaultVatTreatment: customer.defaultVatTreatment,
      invoiceEmail: customer.invoiceEmail,
      iban: customer.iban,
      equivalenceSurcharge: customer.equivalenceSurcharge,
      viesStatus: customer.viesStatus,
      viesName: customer.viesName,
      viesCheckedAt: customer.viesCheckedAt,
    })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)))
    .limit(1);
  if (!rows[0]) notFound();
  const data = rows[0];
  // Preferencia de recordatorios de cobro (misma que en «Cobros pendientes»): solo si puede cambiarla.
  const dunningOptOut = can(ctx.membership.role, "invoice.write") ? await isCustomerDunningOptedOut(ctx.company.id, data.id) : undefined;

  return (
    <PageShell>
      <PageHeader
        title="Editar cliente"
        description={[data.number, data.name].filter(Boolean).join(" · ")}
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Clientes", href: "/customers" },
          { label: data.name, href: `/customers/${data.id}` },
          { label: "Editar" },
        ]}
      />
      <PageSection title="Datos del cliente" description="Actualiza identidad fiscal, contacto y condiciones de facturación.">
        <EditCustomerForm
          id={data.id}
          defaults={{
            name: data.name,
            taxId: data.taxId ?? "",
            address: data.address ?? "",
            addressLine2: data.addressLine2,
            postalCode: data.postalCode ?? "",
            city: data.city ?? "",
            province: data.province ?? "",
            countryCode: data.countryCode ?? "ES",
            email: data.email,
            phone: data.phone,
            status: data.status,
            paymentTermsDays: data.paymentTermsDays ?? null,
            defaultRetentionRate: data.defaultRetentionRate === null ? null : Number(data.defaultRetentionRate),
            defaultVatTreatment: data.defaultVatTreatment,
            invoiceEmail: data.invoiceEmail,
            iban: data.iban,
            equivalenceSurcharge: data.equivalenceSurcharge,
          }}
          vies={{ status: data.viesStatus, name: data.viesName, checkedAt: data.viesCheckedAt }}
          dunningOptOut={dunningOptOut}
        />
      </PageSection>
    </PageShell>
  );
}
