import { and, eq } from "drizzle-orm";

import { companyIntegration } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { recordAudit } from "@/server/audit";

import { stripeAccountCheck } from "./stripe";
import { whatsappNumberCheck } from "./whatsapp";

export const INTEGRATION_PROVIDERS = ["STRIPE", "REDSYS", "WHATSAPP"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/** Campos no secretos de cada integración (se ven en la pantalla) y secretos (solo se escriben). */
export const INTEGRATION_FIELDS: Record<IntegrationProvider, { config: readonly string[]; secrets: readonly string[] }> = {
  STRIPE: { config: [], secrets: ["secretKey", "webhookSecret"] },
  REDSYS: { config: ["merchantCode", "terminal", "environment", "merchantName"], secrets: ["merchantKey"] },
  WHATSAPP: { config: ["phoneNumberId", "language", "countryCode", "templateConfirmed", "templatePending", "templateReminder", "templateCancelled", "templateWaitlist"], secrets: ["accessToken"] },
};

const PURPOSE = "company-integration";

function encryptionSecret() {
  const secret = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error("Falta JWT_SECRET para cifrar las claves de las integraciones.");
  return secret;
}

export type ActorRef = { tenantId: string; companyId: string; actorUserId: string };

/** Para la pantalla: estado y campos no secretos; de los secretos solo si están puestos. */
export async function listIntegrations(companyId: string) {
  const rows = await db.select().from(companyIntegration).where(eq(companyIntegration.companyId, companyId));
  return Object.fromEntries(INTEGRATION_PROVIDERS.map((provider) => {
    const row = rows.find((entry) => entry.provider === provider);
    let secretsSet: string[] = [];
    if (row?.secretEncrypted) {
      try {
        const secrets = JSON.parse(openSecret(row.secretEncrypted, PURPOSE, encryptionSecret())) as Record<string, string>;
        secretsSet = Object.keys(secrets).filter((key) => secrets[key]);
      } catch {
        secretsSet = [];
      }
    }
    return [provider, { enabled: row?.enabled ?? false, config: row?.config ?? {}, secretsSet, lastTestAt: row?.lastTestAt?.toISOString() ?? null, lastTestOk: row?.lastTestOk ?? null }];
  })) as Record<IntegrationProvider, { enabled: boolean; config: Record<string, string>; secretsSet: string[]; lastTestAt: string | null; lastTestOk: boolean | null }>;
}

/** Con los secretos descifrados (solo en el servidor, para usarla). */
export async function loadIntegration(companyId: string, provider: IntegrationProvider) {
  const [row] = await db.select().from(companyIntegration).where(and(eq(companyIntegration.companyId, companyId), eq(companyIntegration.provider, provider))).limit(1);
  if (!row) return null;
  const secrets = row.secretEncrypted ? (JSON.parse(openSecret(row.secretEncrypted, PURPOSE, encryptionSecret())) as Record<string, string>) : {};
  return { enabled: row.enabled, config: row.config, secrets };
}

/** Guarda una integración; un secreto vacío conserva el que ya hubiera. */
export async function saveIntegration(actor: ActorRef, provider: IntegrationProvider, input: { enabled: boolean; config: Record<string, string>; secrets: Record<string, string> }) {
  const fields = INTEGRATION_FIELDS[provider];
  const config = Object.fromEntries(fields.config.map((key) => [key, (input.config[key] ?? "").trim()]).filter(([, value]) => value));
  const current = await loadIntegration(actor.companyId, provider).catch(() => null);
  const secrets = { ...(current?.secrets ?? {}) };
  for (const key of fields.secrets) {
    const value = input.secrets[key]?.trim();
    if (value) secrets[key] = value;
  }
  validate(provider, config, secrets, input.enabled);
  const values = { enabled: input.enabled, config, secretEncrypted: Object.keys(secrets).length > 0 ? sealSecret(JSON.stringify(secrets), PURPOSE, encryptionSecret()) : null, updatedAt: new Date() };
  await db.insert(companyIntegration).values({ companyId: actor.companyId, provider, ...values }).onConflictDoUpdate({ target: [companyIntegration.companyId, companyIntegration.provider], set: values });
  // En la auditoría nunca van los secretos: solo qué campos se cambiaron.
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "company_integration.save", entityName: "company_integration", entityId: provider, payload: { provider, enabled: input.enabled, config, secretsChanged: Object.keys(input.secrets).filter((key) => input.secrets[key]?.trim()) } });
  return { provider };
}

function validate(provider: IntegrationProvider, config: Record<string, string>, secrets: Record<string, string>, enabled: boolean) {
  if (provider === "STRIPE") {
    if (secrets.secretKey && !/^(sk|rk)_(test|live)_/.test(secrets.secretKey)) throw new HttpError(400, "La clave secreta de Stripe empieza por sk_live_ o sk_test_ (o rk_ si es restringida).");
    if (secrets.webhookSecret && !secrets.webhookSecret.startsWith("whsec_")) throw new HttpError(400, "El secreto del webhook de Stripe empieza por whsec_.");
    if (enabled && !secrets.secretKey) throw new HttpError(400, "Para activar Stripe falta la clave secreta.");
  }
  if (provider === "REDSYS") {
    if (config.merchantCode && !/^\d{6,12}$/.test(config.merchantCode)) throw new HttpError(400, "El código de comercio (FUC) de Redsys son 9 cifras.");
    if (config.terminal && !/^\d{1,3}$/.test(config.terminal)) throw new HttpError(400, "El terminal de Redsys es un número (normalmente 1).");
    if (config.environment && !["test", "live"].includes(config.environment)) throw new HttpError(400, "Entorno de Redsys no válido.");
    if (secrets.merchantKey && Buffer.from(secrets.merchantKey, "base64").length !== 24) throw new HttpError(400, "La clave secreta (SHA-256) de Redsys no tiene el formato esperado: cópiala tal cual del panel del banco.");
    if (enabled && (!config.merchantCode || !secrets.merchantKey)) throw new HttpError(400, "Para activar Redsys faltan el código de comercio y la clave secreta.");
  }
  if (provider === "WHATSAPP") {
    if (config.phoneNumberId && !/^\d{5,25}$/.test(config.phoneNumberId)) throw new HttpError(400, "El identificador del número de WhatsApp son solo cifras (Meta → WhatsApp → Configuración de la API).");
    if (enabled && (!config.phoneNumberId || !secrets.accessToken)) throw new HttpError(400, "Para activar WhatsApp faltan el identificador del número y el token de acceso.");
  }
}

/** Prueba la conexión con las claves guardadas (sin cobrar ni enviar nada). */
export async function testIntegration(actor: ActorRef, provider: IntegrationProvider) {
  const integration = await loadIntegration(actor.companyId, provider);
  if (!integration) throw new HttpError(400, "Guarda primero los datos.");
  let ok = false;
  let message = "";
  try {
    if (provider === "STRIPE") {
      if (!integration.secrets.secretKey) throw new Error("Falta la clave secreta.");
      await stripeAccountCheck(integration.secrets.secretKey);
      message = integration.secrets.secretKey.includes("_test_") ? "Conectado con Stripe (modo de pruebas)." : "Conectado con Stripe.";
    } else if (provider === "WHATSAPP") {
      if (!integration.config.phoneNumberId || !integration.secrets.accessToken) throw new Error("Faltan el número o el token.");
      const info = await whatsappNumberCheck({ phoneNumberId: integration.config.phoneNumberId, accessToken: integration.secrets.accessToken });
      message = `Conectado con WhatsApp: ${info.verified_name ?? ""} ${info.display_phone_number ?? ""}`.trim();
    } else {
      // Redsys no tiene una llamada de prueba sin cobrar: se comprueba que los datos estén completos.
      if (!integration.config.merchantCode || !integration.secrets.merchantKey) throw new Error("Faltan el código de comercio o la clave.");
      message = `Datos de Redsys completos (${integration.config.environment === "live" ? "real" : "pruebas"}). Haz una reserva de prueba para comprobar el cobro.`;
    }
    ok = true;
  } catch (error) {
    message = error instanceof Error ? error.message : "No se pudo conectar.";
  }
  await db.update(companyIntegration).set({ lastTestAt: new Date(), lastTestOk: ok }).where(and(eq(companyIntegration.companyId, actor.companyId), eq(companyIntegration.provider, provider)));
  return { ok, message };
}
