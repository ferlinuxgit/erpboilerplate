import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { EditSupplierForm } from "@/components/suppliers/edit-supplier-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { accountChart, paymentMethod } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import { getSupplier } from "@/server/suppliers/service";

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { id } = await params;
  const [data, paymentMethods, supplierAccounts] = await Promise.all([
    getSupplier(db, ctx.company.id, id),
    db
      .select({ id: paymentMethod.id, name: paymentMethod.name })
      .from(paymentMethod)
      .where(eq(paymentMethod.companyId, ctx.company.id)),
    db
      .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
      .from(accountChart)
      .where(eq(accountChart.companyId, ctx.company.id)),
  ]);
  if (!data) notFound();

  return (
    <PageShell>
      <PageHeader eyebrow="Proveedores" title="Editar proveedor" description={data.name} backHref="/suppliers" backLabel="Volver a proveedores" />
      <PageSection title="Datos del proveedor" description="Actualiza identidad, contacto y estado del proveedor.">
        <EditSupplierForm
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
          defaultStatus={data.isActive ? "ACTIVE" : "INACTIVE"}
          defaultPaymentTermsDays={data.paymentTermsDays}
          defaultPaymentMethodId={data.paymentMethodId}
          defaultAccountId={data.defaultAccountId}
          defaultCurrencyCode={data.currencyCode}
          defaultAccounts={supplierAccounts.filter((account) => account.code.startsWith("410"))}
          paymentMethods={paymentMethods}
        />
      </PageSection>
    </PageShell>
  );
}
