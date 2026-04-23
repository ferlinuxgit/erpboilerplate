import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { acceptInvitation } from "@/server/team/service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const { id } = await params;
  const accepted = await acceptInvitation(session.user.id, id);
  if (!accepted) return NextResponse.json({ message: "Invitación inválida o expirada." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
