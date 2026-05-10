import { SecurityPolicyForm } from "@/app/settings/security/security-policy-form";
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
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Settings · Security</p>
        <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-zinc-950">Tenant security controls</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-600">
              Configure session, two-factor, API key, domain and IP policy controls for {ctx.tenant.name}.
            </p>
          </div>
          <div className="rounded-xl border bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
            <p>
              Role: <span className="font-semibold">{ctx.membership.role}</span>
            </p>
            <p>
              Access: <span className="font-semibold">{canManage ? "Admin controls enabled" : "Read-only"}</span>
            </p>
          </div>
        </div>
      </div>

      <SecurityPolicyForm initialPolicy={state} canManage={canManage} />
    </div>
  );
}
