import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { deleteJournalEntry, getJournalEntry, updateJournalEntry } from "@/server/accounting/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const entry = await getJournalEntry(ctx.company.id, id);
  if (!entry) return NextResponse.json({ message: "Asiento no encontrado." }, { status: 404 });
  return NextResponse.json(entry);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await readJsonBody(request)) as { postedAt?: string; reference?: string; lines?: Array<{ accountId: string; debit: string; credit: string }> } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.postedAt || !payload.lines) return NextResponse.json({ message: "Faltan datos." }, { status: 400 });
  const { id } = await params;
  try {
    const updated = await updateJournalEntry(ctx.company.id, ctx.tenant.id, session.user.id, id, {
      postedAt: new Date(payload.postedAt),
      reference: payload.reference?.trim(),
      lines: payload.lines,
    });
    if (!updated) return NextResponse.json({ message: "Asiento no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Error de validacion." }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  const deleted = await deleteJournalEntry(ctx.company.id, ctx.tenant.id, session.user.id, id);
  if (!deleted) return NextResponse.json({ message: "Asiento no encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
