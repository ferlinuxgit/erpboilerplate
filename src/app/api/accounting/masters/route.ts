import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { ensureAccountingMasters, getAccountingMasterStatus } from "@/server/accounting/masters";

const accountSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
});

const journalSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

const payloadSchema = z.object({
  accounts: z.array(accountSchema).optional(),
  journals: z.array(journalSchema).optional(),
});

export async function GET() {
  try {
    const ctx = await requireContext("accounting.read");
    return NextResponse.json(await getAccountingMasterStatus(ctx.company.id));
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

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const status = await ensureAccountingMasters(ctx.company.id, parsed.data);
  return NextResponse.json(status, { status: 201 });
}
