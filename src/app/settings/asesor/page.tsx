import type { Metadata } from "next";
import { headers } from "next/headers";

import { AdvisorAccessManager } from "@/components/settings/advisor-access-manager";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ADVISOR_LOGIN_PATH } from "@/lib/advisor-scopes";
import { requireContext } from "@/lib/current-context";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac";
import { auditActionLabel } from "@/lib/status-labels";
import { listAdvisorAccesses, listAdvisorActivity } from "@/server/advisor/admin";
import { appBaseUrl } from "@/server/email/templates";

export const metadata: Metadata = { title: "Acceso del asesor" };

const downloadKindLabels: Record<string, string> = {
  "sales-pdf": "PDF de factura emitida",
  "sales-zip": "Facturas emitidas (ZIP con PDF)",
  "sales-xlsx": "Listado de facturas emitidas",
  "expense-document": "Documento de factura recibida",
  "expenses-zip": "Facturas recibidas (ZIP con documentos)",
  "expenses-xlsx": "Listado de facturas recibidas",
  "fiscal-report-pdf": "PDF de modelo",
  "full-package": "Documentación completa del periodo",
};

function describe(payload: Record<string, unknown>) {
  const kind = typeof payload.kind === "string" ? payload.kind : null;
  const label = kind ? downloadKindLabels[kind] ?? (kind.startsWith("book-") ? `Libro: ${kind.slice(5)}` : kind.startsWith("data-") ? `Listado: ${kind.slice(5)}` : kind) : null;
  const parts = [label, typeof payload.number === "string" ? payload.number : null, typeof payload.code === "string" ? `Modelo ${payload.code} ${String(payload.period ?? "")}` : typeof payload.period === "string" ? payload.period : null, typeof payload.selected === "number" ? `${payload.selected} seleccionadas` : null];
  return parts.filter(Boolean).join(" · ");
}

export default async function AdvisorAccessSettingsPage() {
  const ctx = await requireContext("team.read");
  const canManage = can(ctx.membership.role, "team.write");
  const [rows, activity] = await Promise.all([listAdvisorAccesses(ctx.company.id), listAdvisorActivity(ctx.company.id)]);
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const baseUrl = process.env.APP_URL?.trim() ? appBaseUrl() : host ? `${protocol}://${host}` : appBaseUrl();
  const portalUrl = `${baseUrl.replace(/\/$/, "")}${ADVISOR_LOGIN_PATH}`;
  const names = new Map(rows.map((row) => [row.id, row.name]));

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Configuración", href: "/settings" }, { label: "Acceso del asesor" }]}
        description={`Tu gestoría entra en ${portalUrl} con su email y contraseña y descarga la documentación de ${ctx.company.name}: facturas, gastos, libros, modelos y listados. Solo consulta: no puede modificar nada.`}
        title="Acceso del asesor"
      />
      <PageSection description="Cada acceso es para esta empresa. Revocar o cambiar la contraseña cierra su sesión al momento." title="Accesos">
        <AdvisorAccessManager
          canManage={canManage}
          companyName={ctx.company.name}
          portalUrl={portalUrl}
          rows={rows.map((row) => ({
            ...row,
            expiresAt: row.expiresAt?.toISOString() ?? null,
            lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          }))}
        />
      </PageSection>
      <PageSection description="Últimas entradas y descargas del asesor (las 30 más recientes)." title="Actividad del asesor">
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay actividad.</p>
        ) : (
          <TableContainer>
            <Table data-testid="advisor-activity">
              <TableHeader>
                <TableRow><TableHead>Fecha</TableHead><TableHead>Asesor</TableHead><TableHead>Qué</TableHead><TableHead>Detalle</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TableCell>
                    <TableCell>{typeof entry.payload.advisor === "string" ? entry.payload.advisor : names.get(entry.accessId) ?? "—"}</TableCell>
                    <TableCell>{auditActionLabel(entry.action)}</TableCell>
                    <TableCell className="max-w-96 whitespace-normal text-muted-foreground">{describe(entry.payload) || (typeof entry.payload.email === "string" ? entry.payload.email : "")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </PageSection>
    </PageShell>
  );
}
