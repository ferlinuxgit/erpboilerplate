import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth-page-shell";
import { OAuthConsentForm } from "@/components/oauth/oauth-consent-form";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { listAuthorizableCompanies, OAuthError, validateAuthorizationRequest } from "@/server/oauth/core";

export const metadata: Metadata = { title: "Conectar aplicación" };

/**
 * Consentimiento OAuth: Claude, ChatGPT u otro cliente MCP piden acceso. El usuario (con sesión;
 * si no, pasa por el login y vuelve aquí) elige empresa y nivel de acceso y lo permite.
 */
export default async function OAuthAuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams(Object.entries(raw).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : Array.isArray(value) && value[0] ? [[key, value[0]]] : [])));
  let validated: ReturnType<typeof validateAuthorizationRequest> | null = null;
  let problem: string | null = null;
  try {
    validated = validateAuthorizationRequest(params);
  } catch (error) {
    problem = error instanceof OAuthError ? error.message : "Solicitud de conexión no válida.";
  }

  const session = await requireUserSession();
  // Alguien recién registrado aún no tiene empresa hasta entrar en el panel: se crea igual que allí
  // para que pueda conectar el asistente nada más darse de alta.
  if (validated) await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const companies = validated ? await listAuthorizableCompanies(session.user.id) : [];

  return (
    <AuthPageShell>
      <div className="space-y-3 p-4 sm:p-6">
        {validated ? (
          <OAuthConsentForm
            clientName={validated.client.name}
            companies={companies}
            params={params.toString()}
            requestedScope={validated.request.scope}
            userEmail={session.user.email}
          />
        ) : (
          <div role="alert">
            <h1 className="font-mono text-lg font-bold">No se puede conectar</h1>
            <p className="mt-2 text-sm text-window-muted">{problem}</p>
          </div>
        )}
      </div>
    </AuthPageShell>
  );
}
