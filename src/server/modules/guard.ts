import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { REQUEST_METHOD_HEADER, REQUEST_PATH_HEADER } from "@/lib/auth";
import { billingDenial } from "@/lib/billing/access";
import { HttpError } from "@/lib/http";
import { getTenantBillingAccess } from "@/server/billing/access";
import { moduleForPath } from "@/modules/registry";
import { isModuleEnabled, ModuleDisabledError } from "@/server/modules/service";

async function requestHeader(name: string) {
  try {
    return (await headers()).get(name);
  } catch {
    // Fuera de una petición (tareas en segundo plano, scripts): no hay ruta que proteger.
    return null;
  }
}

const requestPath = () => requestHeader(REQUEST_PATH_HEADER);

/**
 * Cobro: una cuenta suspendida no puede usar nada y una en solo lectura (prueba terminada,
 * impago, cancelada) no puede crear ni modificar por la API (402). Las páginas se ven siempre:
 * muestran el aviso y llevan a Facturación.
 */
export async function enforceBillingForRequest(tenantId: string, pathname?: string | null, method?: string | null) {
  const path = pathname ?? (await requestPath());
  const verb = method ?? (await requestHeader(REQUEST_METHOD_HEADER));
  if (!path) return;
  const denial = billingDenial(await getTenantBillingAccess(tenantId), path.split("?")[0], verb);
  if (!denial) return;
  if (!path.startsWith("/api/")) {
    if (!path.startsWith("/billing")) redirect("/billing?suspended=1");
    return;
  }
  throw new HttpError(denial.status, denial.message);
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
