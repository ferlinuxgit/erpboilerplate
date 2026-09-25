import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth-page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserSession } from "@/lib/current-user";
import { formatDate } from "@/lib/format";
import { isAppRole, roleDescriptions } from "@/lib/rbac";
import { roleLabels, statusLabel } from "@/lib/status-labels";
import { getInvitationPreview } from "@/server/team/service";

import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = { title: "Invitación" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, session] = await Promise.all([getInvitationPreview(token), getUserSession()]);

  if (!preview) {
    return (
      <AuthPageShell>
        <Card className="w-full border-0 bg-transparent shadow-none">
          <CardHeader>
            <CardTitle aria-level={1} role="heading">Invitación no encontrada</CardTitle>
            <CardDescription>El enlace no es válido o la invitación se ha cancelado. Pide a quien te invitó que te envíe una nueva.</CardDescription>
          </CardHeader>
        </Card>
      </AuthPageShell>
    );
  }

  const roleLabel = statusLabel(roleLabels, preview.role);
  const roleDescription = isAppRole(preview.role) ? roleDescriptions[preview.role] : "";
  const signedInEmail = session?.user.email ?? null;

  return (
    <AuthPageShell>
      <Card className="w-full border-0 bg-transparent shadow-none">
        <CardHeader>
          <CardTitle aria-level={1} role="heading">Te han invitado a {preview.workspaceName}</CardTitle>
          <CardDescription>
            {preview.inviterName ? <><strong>{preview.inviterName}</strong> te invita a trabajar en </> : "Te invitan a trabajar en "}
            <strong>{preview.companyName}</strong> con el rol <strong>{roleLabel}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border border-window-dark-shadow bg-window-panel p-2 text-sm">
            <dt className="text-muted-foreground">Rol</dt>
            <dd><strong>{roleLabel}</strong>{roleDescription ? <span className="block text-muted-foreground">{roleDescription}</span> : null}</dd>
            <dt className="text-muted-foreground">Para</dt>
            <dd className="break-all">{preview.email}</dd>
            <dt className="text-muted-foreground">Caduca</dt>
            <dd>{formatDate(preview.expiresAt)}</dd>
          </dl>
          <AcceptInvitation
            accepted={Boolean(preview.acceptedAt)}
            expired={preview.expired}
            invitedEmail={preview.email}
            signedInEmail={signedInEmail}
            token={token}
          />
        </CardContent>
      </Card>
    </AuthPageShell>
  );
}
