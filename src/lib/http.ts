import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";

export async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function invalidJsonResponse(message = "El cuerpo de la petición debe ser JSON válido.") {
  return NextResponse.json({ message }, { status: 400 });
}

/**
 * Error con un estado HTTP y un mensaje seguro para el cliente. Cualquier otro
 * error se considera inesperado: se registra en el servidor y se responde con un
 * mensaje genérico (nunca `error.message` crudo).
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "No autorizado.") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Sin permisos para ejecutar esta acción.") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

export function jsonError(status: number, message: string, init?: { headers?: HeadersInit }) {
  return NextResponse.json({ message }, { status, headers: init?.headers });
}

/**
 * Traduce un error capturado en un route handler a una respuesta JSON.
 * - `HttpError` → su estado y mensaje (pensados para el usuario).
 * - Cualquier otro → 500 con `fallbackMessage` y log estructurado.
 */
export function handleRouteError(
  error: unknown,
  scope: string,
  fallbackMessage = "Se ha producido un error inesperado. Inténtalo de nuevo.",
) {
  if (isHttpError(error)) {
    return jsonError(error.status, error.message);
  }

  logger.error({ err: error, scope }, "route.unexpected_error");
  return jsonError(500, fallbackMessage);
}

/**
 * URL de adjunto segura para guardar y renderizar como enlace: `https://`/`http://`
 * absolutas o rutas relativas del mismo origen (`/uploads/…`). Rechaza
 * `javascript:`, `data:`, `//host` (protocol-relative) y barras invertidas.
 */
export function isSafeAttachmentUrl(value: string): boolean {
  const candidate = value.trim();
  if (!candidate || candidate.length > 2048 || /[\\\u0000-\u001f\u007f\s]/.test(candidate)) return false;
  if (candidate.startsWith("/")) return !candidate.startsWith("//");
  try {
    const url = new URL(candidate);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
