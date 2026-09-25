import type { Metadata } from "next";
import { headers } from "next/headers";

import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { PendingInvitationsList } from "@/components/settings/pending-invitations-list";
import { TeamMembersList } from "@/components/settings/team-members-list";
import { WorkspaceNameForm } from "@/components/settings/workspace-name-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { assignableRoles, can } from "@/lib/rbac";
import { appBaseUrl } from "@/server/email/templates";
import { invitationPath } from "@/server/team/invitations";
import { listPendingInvitations, listTeamMembers } from "@/server/team/service";

export const metadata: Metadata = { title: "Equipo" };

export default async function TeamSettingsPage() {
  const ctx = await requireContext("team.read");
  const canManage = can(ctx.membership.role, "team.write");
  const [members, invitations] = await Promise.all([
    listTeamMembers(ctx.tenant.id),
    canManage ? listPendingInvitations(ctx.tenant.id) : Promise.resolve([]),
  ]);
  const renderedAt = new Date().getTime();
  // Sin APP_URL, el enlace copiable usa el host de la petición actual.
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const baseUrl = process.env.APP_URL?.trim() ? appBaseUrl() : host ? `${protocol}://${host}` : appBaseUrl();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Equipo"
        description={`Personas con acceso a ${ctx.tenant.name} y qué puede hacer cada una.`}
        actions={canManage ? <InviteMemberForm assignableRoles={assignableRoles(ctx.membership.role)} /> : null}
      />
      {can(ctx.membership.role, "settings.manage") ? (
        <PageSection title="Espacio de trabajo" description="El nombre con el que te verán tus invitados.">
          <WorkspaceNameForm initialName={ctx.tenant.name} />
        </PageSection>
      ) : null}
      <PageSection
        title="Miembros"
        description="Tu gestor o asesor puede llevar contabilidad e impuestos sin tocar la configuración ni el equipo."
      >
        <TeamMembersList actorRole={ctx.membership.role} canManage={canManage} currentUserId={ctx.user.id} rows={members} />
      </PageSection>
      {canManage ? (
        <PageSection title="Invitaciones pendientes" description="Reenvía, copia el enlace o cancela las invitaciones que aún no se han aceptado.">
          <PendingInvitationsList
            rows={invitations.map((entry) => ({
              id: entry.id,
              email: entry.email,
              role: entry.role,
              url: `${baseUrl}${invitationPath(entry.token)}`,
              expiresAt: entry.expiresAt.toISOString(),
              expired: entry.expiresAt.getTime() <= renderedAt,
              invitedByName: entry.invitedByName,
            }))}
          />
        </PageSection>
      ) : null}
    </PageShell>
  );
}
