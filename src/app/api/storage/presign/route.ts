import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { createUploadUrl, isObjectStorageConfigured } from "@/server/storage/s3";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const contentTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/csv"] as const;

const payloadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: z.enum(contentTypes, { message: "Tipo de archivo no permitido. Usa PDF, JPG, PNG, WEBP o CSV." }),
  size: z
    .number({ message: "Indica el tamaño del archivo." })
    .int()
    .positive("El archivo está vacío.")
    .max(MAX_UPLOAD_BYTES, "El archivo supera el tamaño máximo de 15 MB."),
});

function sanitizeFileName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "upload";
}

export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("settings.manage");

    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();

    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos del archivo inválidos.");
    if (!isObjectStorageConfigured()) return jsonError(503, "El almacenamiento de archivos no está configurado.");

    const key = `${ctx.tenant.id}/${ctx.company.id}/${user.id}/${Date.now()}-${sanitizeFileName(parsed.data.fileName)}`;
    const url = await createUploadUrl(key, parsed.data.contentType, parsed.data.size);
    return NextResponse.json({ key, url, maxBytes: MAX_UPLOAD_BYTES });
  } catch (error) {
    return handleRouteError(error, "storage.presign", "No se pudo preparar la subida del archivo.");
  }
}
