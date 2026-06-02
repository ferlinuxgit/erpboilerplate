import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamMembersList } from "@/components/settings/team-members-list";
import { requireContext } from "@/lib/current-context";
import { listTeamMembers } from "@/server/team/service";

export default async function TeamSettingsPage() {
  const ctx = await requireContext("team.read");
  const members = await listTeamMembers(ctx.tenant.id);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Equipo</CardTitle></CardHeader>
        <CardContent>
          <TeamMembersList rows={members} />
        </CardContent>
      </Card>
    </main>
  );
}
