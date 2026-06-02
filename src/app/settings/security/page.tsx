import { SecurityPolicyForm } from "@/app/settings/security/security-policy-form";
import { PageHeader, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getTenantSecurityPolicyState } from "@/server/security-policy";

export default async function SecuritySettingsPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant(session.user);
  const state = await getTenantSecurityPolicyState(ctx.tenant.id);
  const canManage = can(ctx.membership.role, "settings.manage");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Seguridad"
        description={`Controles de sesión, doble factor, claves API, dominios e IPs permitidas para ${ctx.tenant.name}.`}
        meta={
          <>
            <StatusBadge tone="neutral">Rol: {ctx.membership.role}</StatusBadge>
            <StatusBadge tone={canManage ? "success" : "warning"}>{canManage ? "Gestión habilitada" : "Solo lectura"}</StatusBadge>
          </>
        }
      />

      <SecurityPolicyForm initialPolicy={state} canManage={canManage} />
    </PageShell>
  );
}
