import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EditCustomerForm } from "@/components/customers/edit-customer-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, partner } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";

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
    })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)))
    .limit(1);
  if (!rows[0]) notFound();
  const data = rows[0];

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
      <PageSection title="Datos del cliente" description="Actualiza identidad, contacto y estado comercial.">
        <EditCustomerForm
          id={data.id}
          defaultName={data.name}
          defaultTaxId={data.taxId ?? ""}
          defaultAddress={data.address ?? ""}
          defaultAddressLine2={data.addressLine2}
          defaultPostalCode={data.postalCode ?? ""}
          defaultCity={data.city ?? ""}
          defaultProvince={data.province ?? ""}
          defaultCountryCode={data.countryCode ?? "ES"}
          defaultEmail={data.email}
          defaultPhone={data.phone}
          defaultStatus={data.status}
        />
      </PageSection>
    </PageShell>
  );
}
