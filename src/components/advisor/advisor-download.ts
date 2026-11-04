import { readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Nombre del fichero desde `Content-Disposition` (prefiere `filename*` en UTF-8). */
export function fileNameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      // Se usa el nombre ASCII.
    }
  }
  return /filename="([^"]+)"/.exec(header)?.[1] ?? fallback;
}

/** Error de descarga; `sessionExpired` indica que hay que volver a la pantalla de acceso. */
export class AdvisorDownloadError extends Error {
  constructor(message: string, readonly sessionExpired: boolean) {
    super(message);
    this.name = "AdvisorDownloadError";
  }
}

/**
 * Descarga un fichero del portal (GET o POST con JSON) y lo guarda con su nombre. Lanza un error con
 * el mensaje del servidor si falla (sesión caducada, periodo demasiado grande…).
 */
export async function downloadAdvisorFile(input: { href: string; body?: unknown; fallbackName: string; failure: string }) {
  const response = await fetch(input.href, input.body === undefined
    ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(input.body) });
  if (!response.ok) {
    throw new AdvisorDownloadError(await readApiError(response, input.failure), response.status === 401);
  }
  const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), input.fallbackName);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return { fileName, missing: Number(response.headers.get("X-Missing-Documents") ?? 0) };
}
