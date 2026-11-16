"use client";

import { ArrowSquareOut, Copy, Plugs, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";

type Grant = { id: string; scope: "read" | "write"; companyName: string | null; clientName: string; createdAt: string; expiresAt: string };

/** Avisa a la lista de conexiones de que hay cambios (token creado, conexión revocada). */
const GRANTS_CHANGED_EVENT = "erp:ai-grants-changed";

const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";
const CHATGPT_CONNECTORS_URL = "https://chatgpt.com/#settings/Connectors";

async function fetchGrants(): Promise<Grant[] | null> {
  try {
    const response = await fetch("/api/oauth/grants");
    return response.ok ? ((await response.json()) as Grant[]) : null;
  } catch {
    return null;
  }
}

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
    return true;
  } catch {
    toast.error("No se pudo copiar automáticamente: selecciona el texto y cópialo a mano.");
    return false;
  }
}

function CopyField({ id, label, value, helper }: { id: string; label: string; value: string; helper?: string }) {
  return (
    <AccessibleField helperText={helper} id={id} label={label}>
      <div className="flex gap-2">
        <Input className="font-mono text-xs" id={id} readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
        <Button onClick={() => void copyText(value, "Copiado.")} type="button" variant="outline">
          <Copy aria-hidden="true" />
          Copiar
        </Button>
      </div>
    </AccessibleField>
  );
}

/**
 * Conectar el ERP con asistentes de IA: Claude y ChatGPT en un clic (OAuth: el asistente pide
 * permiso y el usuario elige empresa y nivel de acceso), Claude Code / Desktop por comando,
 * cualquier otro cliente MCP con un token personal, y la lista de conexiones para revocarlas.
 */
export function AiConnectionsManager({ actionCount, companyName, mcpUrl, openApiUrl, toolCount }: {
  actionCount: number;
  companyName: string;
  mcpUrl: string;
  openApiUrl: string;
  toolCount: number;
}) {
  const [tokenName, setTokenName] = useState("Cursor");
  const [tokenScope, setTokenScope] = useState<"read" | "write">("read");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function connect(target: "claude" | "chatgpt") {
    await copyText(mcpUrl, "URL del conector copiada: pégala en el asistente.");
    window.open(target === "claude" ? CLAUDE_CONNECTORS_URL : CHATGPT_CONNECTORS_URL, "_blank", "noopener,noreferrer");
  }

  async function createToken() {
    setBusy("create");
    try {
      const response = await fetch("/api/oauth/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ name: tokenName, scope: tokenScope }),
      });
      const body = (await response.json().catch(() => ({}))) as { token?: string; message?: string };
      if (!response.ok || !body.token) throw new Error(body.message ?? "No se pudo crear el token.");
      setCreatedToken(body.token);
      toast.success("Token creado: cópialo ahora, no se volverá a mostrar.");
      window.dispatchEvent(new Event(GRANTS_CHANGED_EVENT));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el token.");
    } finally {
      setBusy(null);
    }
  }

  const claudeCodeCommand = `claude mcp add --transport http erp ${mcpUrl}`;
  const tokenConfig = createdToken
    ? JSON.stringify({ mcpServers: { erp: { url: mcpUrl, headers: { Authorization: `Bearer ${createdToken}` } } } }, null, 2)
    : "";

  return (
    <div className="space-y-4">
      <PageSection
        title="Conectar en un clic"
        description={`El asistente podrá consultar y, si lo permites, gestionar ${companyName} con tus mismos permisos: ${toolCount} herramientas y las ${actionCount} acciones de la API.`}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-surface border border-window-dark-shadow bg-card p-3">
            <h3 className="font-mono text-sm font-bold">Claude</h3>
            <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
              <li>Pulsa el botón: se copia la URL y se abre Claude.</li>
              <li>En Conectores, «Añadir conector personalizado» y pega la URL.</li>
              <li>Pulsa «Conectar», elige empresa y nivel de acceso y «Permitir».</li>
            </ol>
            <Button onClick={() => void connect("claude")} type="button">
              <Plugs aria-hidden="true" />
              Conectar con Claude
              <ArrowSquareOut aria-hidden="true" />
            </Button>
          </div>
          <div className="space-y-2 rounded-surface border border-window-dark-shadow bg-card p-3">
            <h3 className="font-mono text-sm font-bold">ChatGPT</h3>
            <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
              <li>Pulsa el botón: se copia la URL y se abre ChatGPT.</li>
              <li>En Ajustes › Conectores (modo desarrollador), «Crear» y pega la URL con autenticación OAuth.</li>
              <li>Pulsa «Conectar», elige empresa y nivel de acceso y «Permitir».</li>
            </ol>
            <Button onClick={() => void connect("chatgpt")} type="button">
              <Plugs aria-hidden="true" />
              Conectar con ChatGPT
              <ArrowSquareOut aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <CopyField id="ai-mcp-url" label="URL del servidor MCP" value={mcpUrl} helper="La misma para cualquier asistente compatible con MCP y OAuth (Claude, ChatGPT, Le Chat, Copilot…)." />
        </div>
      </PageSection>

      <PageSection title="Claude Code y Claude Desktop" description="Ejecuta el comando; la primera vez se abrirá el navegador para permitir el acceso.">
        <CopyField id="ai-claude-code" label="Comando" value={claudeCodeCommand} />
      </PageSection>

      <PageSection title="Otros asistentes (token personal)" description="Para clientes MCP sin OAuth (Cursor, scripts…). El token caduca a los 90 días y puedes revocarlo abajo.">
        <div className="grid gap-3 md:grid-cols-3">
          <AccessibleField id="ai-token-name" label="Nombre">
            <Input id="ai-token-name" maxLength={60} value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
          </AccessibleField>
          <AccessibleField id="ai-token-scope" label="Acceso">
            <Select id="ai-token-scope" value={tokenScope} onChange={(event) => setTokenScope(event.target.value as "read" | "write")}>
              <option value="read">Solo consultar</option>
              <option value="write">Consultar y gestionar</option>
            </Select>
          </AccessibleField>
          <div className="flex items-end">
            <Button disabled={busy === "create" || !tokenName.trim()} onClick={() => void createToken()} type="button">
              {busy === "create" ? "Creando…" : "Crear token"}
            </Button>
          </div>
        </div>
        {createdToken ? (
          <div className="mt-3 space-y-2">
            <InlineAlert tone="warning">Copia el token ahora: por seguridad no se vuelve a mostrar.</InlineAlert>
            <CopyField id="ai-token-value" label="Token" value={createdToken} />
            <AccessibleField id="ai-token-config" label="Configuración MCP (JSON)">
              <textarea className="h-36 w-full rounded-control border border-window-dark-shadow bg-card p-2 font-mono text-xs" id="ai-token-config" readOnly value={tokenConfig} />
            </AccessibleField>
            <Button onClick={() => void copyText(tokenConfig, "Configuración copiada.")} type="button" variant="outline">
              <Copy aria-hidden="true" />
              Copiar configuración
            </Button>
          </div>
        ) : null}
      </PageSection>


      <PageSection title="Para desarrolladores" description="Toda la API documentada en OpenAPI 3.1 (también sirve para GPTs personalizados con acciones y OAuth).">
        <CopyField id="ai-openapi" label="Especificación OpenAPI" value={openApiUrl} />
      </PageSection>
    </div>
  );
}

/** Conexiones activas (OAuth y tokens personales) con «Desconectar». */
export function AiConnectionsList() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const applyGrants = useCallback((result: Grant[] | null) => {
    if (result) {
      setGrants(result);
      setLoadError(null);
    } else {
      setLoadError("No se pudieron cargar las conexiones.");
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const refresh = () => void fetchGrants().then((result) => {
      if (!ignore) applyGrants(result);
    });
    refresh();
    window.addEventListener(GRANTS_CHANGED_EVENT, refresh);
    return () => {
      ignore = true;
      window.removeEventListener(GRANTS_CHANGED_EVENT, refresh);
    };
  }, [applyGrants]);

  async function revoke(grant: Grant) {
    setBusy(grant.id);
    try {
      const response = await fetch(`/api/oauth/grants?id=${encodeURIComponent(grant.id)}`, { method: "DELETE", headers: getCsrfHeader() });
      if (!response.ok) throw new Error();
      toast.success(`${grant.clientName} desconectado.`);
      window.dispatchEvent(new Event(GRANTS_CHANGED_EVENT));
    } catch {
      toast.error("No se pudo desconectar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="ai-connections">
        {loadError ? <InlineAlert role="alert" tone="danger">{loadError}</InlineAlert> : null}
        {grants === null && !loadError ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
        {grants && grants.length === 0 ? <p className="text-sm text-muted-foreground">Ninguna aplicación conectada todavía.</p> : null}
        {grants && grants.length > 0 ? (
          <ul className="divide-y divide-window-shadow rounded-surface border border-window-dark-shadow">
            {grants.map((grant) => (
              <li className="flex flex-wrap items-center justify-between gap-2 p-2.5" key={grant.id}>
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold">{grant.clientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {grant.companyName ?? "Empresa"} · {grant.scope === "write" ? "consultar y gestionar" : "solo consultar"} · conectado el {formatDate(grant.createdAt)}
                  </p>
                </div>
                <Button disabled={busy === grant.id} onClick={() => void revoke(grant)} size="sm" type="button" variant="outline">
                  <Trash aria-hidden="true" />
                  Desconectar
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
    </div>
  );
}
