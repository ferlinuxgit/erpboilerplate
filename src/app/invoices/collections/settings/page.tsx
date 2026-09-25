import type { Metadata } from "next";

import { EmailSettingsForm } from "@/components/invoice-email/email-settings-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { getInvoiceEmailSettings } from "@/server/invoice-email/service";
import { isEmailDeliveryConfigured } from "@/server/email/send";

export const metadata: Metadata = { title: "Plantillas de email y recordatorios" };

export default async function InvoiceEmailSettingsPage() {
  await requireUserSession();
  const ctx = await requireContext("invoice.read");
  const settings = await getInvoiceEmailSettings(ctx.company.id);

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Facturas", href: "/invoices" },
          { label: "Cobros pendientes", href: "/invoices/collections" },
          { label: "Plantillas y recordatorios" },
        ]}
        title="Plantillas de email y recordatorios"
        description="Textos que se proponen al enviar una factura o reclamar un cobro, y cuándo se envían los recordatorios automáticos."
      />
      <PageSection title="Plantillas y calendario">
        <EmailSettingsForm
          canEdit={can(ctx.membership.role, "invoice.write")}
          initial={{ templates: settings.templates, copyToSelfDefault: settings.copyToSelfDefault, dunning: settings.dunning }}
          smtpConfigured={isEmailDeliveryConfigured()}
        />
      </PageSection>
    </PageShell>
  );
}
