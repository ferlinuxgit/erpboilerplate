import { TeamMembersList } from "@/components/settings/team-members-list";
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
        description={`Miembros y roles con acceso al tenant ${ctx.tenant.name}.`}
      />
      <PageSection title="Miembros" description="Controla quién puede operar, auditar o administrar la empresa activa.">
        <TeamMembersList rows={members} />
      </PageSection>
    </PageShell>
  );
}
