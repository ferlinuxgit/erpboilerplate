import { eq } from "drizzle-orm";
import type { Metadata } from "next";

import { SepaCreditorForm } from "@/components/company/sepa-creditor-form";
import { EmailSettingsForm } from "@/components/invoice-email/email-settings-form";
import { MastersPanel } from "@/components/settings/masters-panel";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { PageSection, PageShell } from "@/components/ui/page";
import { company } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { isEmailDeliveryConfigured } from "@/server/email/send";
import { getInvoiceEmailSettings } from "@/server/invoice-email/service";

export const metadata: Metadata = { title: "Cobros y pagos" };

export default async function PaymentsSettingsPage() {
  const ctx = await requireContext("invoice.read");
  const canManage = can(ctx.membership.role, "settings.manage");
  const [emailSettings, [sepa]] = await Promise.all([
    getInvoiceEmailSettings(ctx.company.id),
    canManage
      ? db.select({ sepaCreditorId: company.sepaCreditorId, vatNumber: company.vatNumber }).from(company).where(eq(company.id, ctx.company.id)).limit(1)
      : Promise.resolve([]),
  ]);

  return (
    <PageShell>
      <SettingsPageHeader sectionId="payments" />
      {canManage ? (
        <PageSection className="scroll-mt-24" id="formas-de-pago" title="Formas de pago" description="Cómo te pagan tus clientes y la cuenta que aparece en la factura.">
          <MastersPanel blocks={["paymentMethods"]} />
        </PageSection>
      ) : null}
      {canManage && sepa ? (
        <PageSection className="scroll-mt-24" id="sepa" title="Recibos domiciliados (SEPA)" description="Necesario para generar remesas de adeudos directos desde Tesorería.">
          <SepaCreditorForm initialValue={sepa.sepaCreditorId} vatNumber={sepa.vatNumber} />
        </PageSection>
      ) : null}
      <PageSection className="scroll-mt-24" id="emails" title="Emails y recordatorios de cobro" description="Textos que se proponen al enviar una factura o reclamar un cobro, y cuándo salen los recordatorios automáticos.">
        <EmailSettingsForm
          canEdit={can(ctx.membership.role, "invoice.write")}
          initial={{ templates: emailSettings.templates, copyToSelfDefault: emailSettings.copyToSelfDefault, dunning: emailSettings.dunning }}
          smtpConfigured={isEmailDeliveryConfigured()}
        />
      </PageSection>
    </PageShell>
  );
}
