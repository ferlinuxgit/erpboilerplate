import type { Metadata } from "next";

import { ExternalAiSetting } from "@/components/settings/external-ai-setting";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getExpenseOcrSettings } from "@/server/ocr/settings";

export const metadata: Metadata = { title: "Automatización" };

export default async function AutomationSettingsPage() {
  const ctx = await requireContext("settings.manage");
  const ocr = await getExpenseOcrSettings(ctx.company.id, Boolean(process.env.OPENAI_API_KEY));

  return (
    <PageShell>
      <SettingsPageHeader sectionId="automation" />
      <PageSection className="scroll-mt-24" id="ocr" title="Lectura de facturas con IA" description="Cómo se leen las facturas que subes a la bandeja de gastos.">
        <ExternalAiSetting configured={ocr.externalAiConfigured} initialEnabled={ocr.externalAiEnabled} />
      </PageSection>
    </PageShell>
  );
}
