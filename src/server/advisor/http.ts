import { HttpError } from "@/lib/http";
import { recordAdvisorAudit, type AdvisorContext } from "@/server/advisor/auth";
import { loadAdvisorPeriod } from "@/server/advisor/data";
import type { AdvisorFile } from "@/server/advisor/exports";

/** Utilidades de las rutas `/api/advisor/*`. */

/** `Content-Disposition` con nombre ASCII y su versión UTF-8 (RFC 6266). */
export function attachmentDisposition(fileName: string, disposition: "attachment" | "inline" = "attachment") {
  const ascii = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function fileResponse(file: Pick<AdvisorFile, "bytes" | "fileName" | "contentType"> & { missing?: number }, disposition: "attachment" | "inline" = "attachment") {
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": attachmentDisposition(file.fileName, disposition),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(file.missing ? { "X-Missing-Documents": String(file.missing) } : {}),
    },
  });
}

/** Periodo pedido (`year`, `period`) dentro de los ejercicios de la empresa del acceso. */
export async function requestPeriod(context: AdvisorContext, params: { year?: string | null; period?: string | null }) {
  const { period } = await loadAdvisorPeriod(context.company.id, params);
  if (!period) throw new HttpError(404, "La empresa todavía no tiene ejercicios contables.");
  return period;
}

/** Identificadores seleccionados (POST): lista acotada de cadenas. */
export function parseSelectedIds(value: unknown, max = 1_000) {
  if (!Array.isArray(value)) throw new HttpError(400, "Selecciona al menos un documento.");
  const ids = [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64))];
  if (ids.length === 0) throw new HttpError(400, "Selecciona al menos un documento.");
  if (ids.length > max) throw new HttpError(400, `Puedes seleccionar como máximo ${max} documentos a la vez.`);
  return ids;
}

/** Audita la descarga y devuelve el fichero. */
export async function auditedFile(context: AdvisorContext, kind: string, file: AdvisorFile, extra: Record<string, unknown> = {}) {
  await recordAdvisorAudit(context, "advisor.download", { kind, file: file.fileName, count: file.count, missing: file.missing, ...extra });
  return fileResponse(file);
}
