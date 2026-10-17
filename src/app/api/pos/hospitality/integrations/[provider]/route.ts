import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { INTEGRATION_PROVIDERS, saveIntegration, testIntegration, type IntegrationProvider } from "@/server/integrations/service";

import { posActor } from "../../../actor";

const schema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.string().max(200)).default({}),
  secrets: z.record(z.string(), z.string().max(2000)).default({}),
});

type Params = { params: Promise<{ provider: string }> };

function providerOf(value: string): IntegrationProvider | null {
  const upper = value.toUpperCase();
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(upper) ? (upper as IntegrationProvider) : null;
}

/** Guardar Stripe, Redsys o WhatsApp (los secretos vacíos no cambian). */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    const provider = providerOf((await params).provider);
    if (!provider) return jsonError(404, "Integración desconocida.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Datos inválidos.");
    return NextResponse.json(await saveIntegration(actor, provider, parsed.data));
  } catch (error) {
    return handleRouteError(error, "pos.integrations.save");
  }
}

/** Probar la conexión con lo guardado. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    const provider = providerOf((await params).provider);
    if (!provider) return jsonError(404, "Integración desconocida.");
    return NextResponse.json(await testIntegration(actor, provider));
  } catch (error) {
    return handleRouteError(error, "pos.integrations.test");
  }
}
