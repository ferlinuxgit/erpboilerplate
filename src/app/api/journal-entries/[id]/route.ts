import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
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
  const payload = (await readJsonBody(request)) as { postedAt?: string; reference?: string; acknowledgeLegalizedBooks?: boolean; lines?: Array<{ accountId: string; debit: string; credit: string; concept?: string | null; partnerId?: string | null }> } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.postedAt || !Array.isArray(payload.lines)) return NextResponse.json({ message: "Indica la fecha y las líneas del asiento." }, { status: 400 });
  if (Number.isNaN(new Date(payload.postedAt).getTime())) return NextResponse.json({ message: "La fecha del asiento no es válida." }, { status: 400 });
  const { id } = await params;
  try {
    const updated = await updateJournalEntry(ctx.company.id, ctx.tenant.id, session.user.id, id, {
      postedAt: new Date(payload.postedAt),
      reference: payload.reference?.trim(),
      lines: payload.lines,
      acknowledgeLegalizedBooks: payload.acknowledgeLegalizedBooks === true,
    });
    if (!updated) return NextResponse.json({ message: "Asiento no encontrado." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return handleRouteError(error, "journal-entries.update", "No se pudo guardar el asiento. Inténtalo de nuevo.");
  }
}

/**
 * Revierte el asiento con un contraasiento. Con `?acknowledgeLegalizedBooks=1` se confirma que se
 * sabe que los libros del ejercicio están presentados a legalizar (sin él, responde 409 con el aviso).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const acknowledgeLegalizedBooks = new URL(request.url).searchParams.get("acknowledgeLegalizedBooks") === "1";
    const deleted = await deleteJournalEntry(ctx.company.id, ctx.tenant.id, session.user.id, id, { acknowledgeLegalizedBooks });
    if (!deleted) return NextResponse.json({ message: "Asiento no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "journal-entries.reverse", "No se pudo revertir el asiento. Inténtalo de nuevo.");
  }
}
