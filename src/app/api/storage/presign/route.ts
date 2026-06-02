import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createUploadUrl } from "@/server/storage/s3";

const contentTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/csv"] as const;

const payloadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: z.enum(contentTypes),
});

function sanitizeFileName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "upload";
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "fileName o contentType inválidos." }, { status: 400 });

  const key = `${ctx.tenant.id}/${ctx.company.id}/${session.user.id}/${Date.now()}-${sanitizeFileName(parsed.data.fileName)}`;
  const url = await createUploadUrl(key, parsed.data.contentType);
  return NextResponse.json({ key, url });
}
