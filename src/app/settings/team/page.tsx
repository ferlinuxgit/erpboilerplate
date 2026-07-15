import { TeamMembersList } from "@/components/settings/team-members-list";
import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { listTeamMembers } from "@/server/team/service";

export default async function TeamSettingsPage() {
  const ctx = await requireContext("team.read");
  const members = await listTeamMembers(ctx.tenant.id);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Equipo"
        description={`Miembros y roles con acceso al espacio ${ctx.tenant.name}.`}
        actions={ctx.membership.role !== "MEMBER" ? <InviteMemberForm canInviteOwner={ctx.membership.role === "OWNER"} /> : null}
      />
      <PageSection title="Miembros" description="Controla quién puede operar, auditar o administrar la empresa activa.">
        <TeamMembersList rows={members} />
      </PageSection>
    </PageShell>
  );
}
