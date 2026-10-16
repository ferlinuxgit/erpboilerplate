import { eq } from "drizzle-orm";
import type { Metadata } from "next";

import { PaymentTermsForm } from "@/components/company/payment-terms-form";
import { SepaCreditorForm } from "@/components/company/sepa-creditor-form";
import { EmailSettingsForm } from "@/components/invoice-email/email-settings-form";
import { MastersPanel } from "@/components/settings/masters-panel";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { PageSection, PageShell } from "@/components/ui/page";
import { company, companySettings } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { isEmailDeliveryConfigured } from "@/server/email/send";
import { getInvoiceEmailSettings } from "@/server/invoice-email/service";

export const metadata: Metadata = { title: "Cobros y pagos" };

export default async function PaymentsSettingsPage() {
  const ctx = await requireContext("invoice.read");
  const canManage = can(ctx.membership.role, "settings.manage");
  const [emailSettings, [sepa], [terms]] = await Promise.all([
    getInvoiceEmailSettings(ctx.company.id),
    canManage
      ? db.select({ sepaCreditorId: company.sepaCreditorId, vatNumber: company.vatNumber }).from(company).where(eq(company.id, ctx.company.id)).limit(1)
      : Promise.resolve([]),
    db.select({ paymentTermsDays: companySettings.paymentTermsDays }).from(companySettings).where(eq(companySettings.companyId, ctx.company.id)).limit(1),
  ]);

  return (
    <PageShell>
      <SettingsPageHeader sectionId="payments" />
      {canManage ? (
        <PageSection className="scroll-mt-24" id="formas-de-pago" title="Formas de pago" description="Cómo te pagan tus clientes y la cuenta que aparece en la factura.">
          <MastersPanel blocks={["paymentMethods"]} />
        </PageSection>
      ) : null}
      {canManage ? (
        <PageSection className="scroll-mt-24" id="plazo" title="Plazo de pago por defecto" description="Cuántos días tienen tus clientes para pagar si su ficha no indica otro plazo.">
          <PaymentTermsForm initialValue={terms?.paymentTermsDays ?? 30} />
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
