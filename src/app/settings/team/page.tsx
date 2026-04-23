import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { listTeamMembers } from "@/server/team/service";

export default async function TeamSettingsPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const members = await listTeamMembers(ctx.tenant.id);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Equipo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {members.map((member) => (
            <p key={member.membershipId}>{member.name} ({member.email}) - {member.role}</p>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
