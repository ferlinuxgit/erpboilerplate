import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { createAccount, listAccounts } from "@/server/accounting/service";

export async function GET() {
  try {
    const ctx = await requireContext("accounting.read");
    return NextResponse.json(await listAccounts(ctx.company.id));
  } catch {
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  }
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireContext("accounting.write");
  } catch {
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  }
  const payload = (await readJsonBody(request)) as { code?: string; name?: string; type?: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" } | null;
  if (!payload) return invalidJsonResponse();

  if (!payload.code?.trim() || !payload.name?.trim() || !payload.type) return NextResponse.json({ message: "Datos invalidos." }, { status: 400 });
  const created = await createAccount(ctx.company.id, ctx.tenant.id, ctx.user.id, { code: payload.code.trim(), name: payload.name.trim(), type: payload.type });
  return NextResponse.json(created, { status: 201 });
}
