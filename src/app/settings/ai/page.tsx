import type { Metadata } from "next";
import { headers } from "next/headers";

import { AiConnectionsList, AiConnectionsManager } from "@/components/settings/ai-connections-manager";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { apiCatalog, MCP_TOOL_COUNT } from "@/server/mcp/catalog";
import { publicOrigin } from "@/server/oauth/core";

export const metadata: Metadata = { title: "Conectar con IA" };

export default async function AiSettingsPage() {
  const ctx = await requireContext();
  const requestHeaders = await headers();
  const origin = publicOrigin(new Request(`http://${requestHeaders.get("host") ?? "localhost"}/`, { headers: requestHeaders }));
  return (
    <PageShell>
      <SettingsPageHeader sectionId="ai" />
      <AiConnectionsManager
        actionCount={apiCatalog.length}
        companyName={ctx.company.name}
        mcpUrl={`${origin}/api/mcp`}
        openApiUrl={`${origin}/api/openapi`}
        toolCount={MCP_TOOL_COUNT}
      />
      <PageSection className="scroll-mt-24" id="conexiones" title="Conexiones activas" description="Aplicaciones con acceso a tu cuenta. Al desconectar, dejan de funcionar al momento.">
        <AiConnectionsList />
      </PageSection>
    </PageShell>
  );
}
