import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { REQUEST_PATH_HEADER } from "@/lib/auth";
import { moduleForPath } from "@/modules/registry";
import { isModuleEnabled, ModuleDisabledError } from "@/server/modules/service";

async function requestPath() {
  try {
    return (await headers()).get(REQUEST_PATH_HEADER);
  } catch {
    // Fuera de una petición (tareas en segundo plano, scripts): no hay ruta que proteger.
    return null;
  }
}

/**
 * Guarda única de los módulos: se ejecuta al resolver el contexto de la petición (todas las páginas
 * y APIs pasan por ahí). Si la ruta es de un módulo que la empresa no tiene activado, las páginas
 * llevan a `/modules/<id>` (con la opción de activarlo) y la API responde 403.
 */
export async function enforceModuleForRequest(companyId: string, pathname?: string | null) {
  const path = pathname ?? (await requestPath());
  if (!path) return;
  const manifest = moduleForPath(path);
  if (!manifest || (await isModuleEnabled(companyId, manifest.id))) return;
  if (path.startsWith("/api/")) throw new ModuleDisabledError(manifest.id);
  redirect(`/modules/${manifest.id}?from=${encodeURIComponent(path)}`);
}
