import type { Metadata } from "next";

import { ExternalAiSetting } from "@/components/settings/external-ai-setting";
import { MailInboxSettings } from "@/components/settings/mail-inbox-settings";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getMailInboxSettings } from "@/server/ocr/mail-inbox";
import { getExpenseOcrSettings } from "@/server/ocr/settings";

export const metadata: Metadata = { title: "Automatización" };

export default async function AutomationSettingsPage() {
  const ctx = await requireContext("settings.manage");
  const [ocr, mailInbox] = await Promise.all([
    getExpenseOcrSettings(ctx.company.id, Boolean(process.env.OPENAI_API_KEY)),
    getMailInboxSettings(ctx.company.id),
  ]);

  return (
    <PageShell>
      <SettingsPageHeader sectionId="automation" />
      <PageSection className="scroll-mt-24" id="ocr" title="Lectura de facturas con IA" description="Cómo se leen las facturas que subes a la bandeja de gastos.">
        <ExternalAiSetting configured={ocr.externalAiConfigured} initialEnabled={ocr.externalAiEnabled} />
      </PageSection>
      <PageSection className="scroll-mt-24" id="correo" title="Recibir facturas por email" description="Un buzón al que reenvías las facturas: llegan solas a la bandeja de gastos.">
        <MailInboxSettings initial={mailInbox} suggestedSender={ctx.user.email} />
      </PageSection>
    </PageShell>
  );
}
