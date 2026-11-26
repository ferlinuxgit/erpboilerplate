import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Cobro del SaaS contra Postgres real (PGlite): el webhook de Stripe sincroniza la suscripción y sus
 * módulos, los créditos de IA se compran y se gastan, y lo que no está en el plan no se puede usar.
 */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
}));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});

import * as schema from "@/db/schema";
import { company, companySettings, subscription, tenant, user } from "@/db/schema";
import { getTenantBillingAccess } from "@/server/billing/access";
import { assertOcrCreditsAvailable, chargeOcrUsage, getOcrCreditBalance } from "@/server/billing/credits";
import { handleStripeEvent, type WebhookDeps } from "@/server/billing/webhook";
import { isModuleEnabled, listModuleStates, setCompanyModule } from "@/server/modules/service";

const USER = "user-1";

beforeAll(async () => {
  vi.stubEnv("BILLING_ENFORCED", "true");
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: USER, name: "Ana", email: "ana@example.com" });
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await state.client?.close();
});

async function createTenant(id: string, trialEndsAt: Date | null) {
  await state.db.insert(tenant).values({ id, name: `Espacio ${id}`, slug: id, ownerId: USER, trialEndsAt });
  await state.db.insert(company).values({ id: `${id}-co`, tenantId: id, name: `Empresa ${id}` });
  await state.db.insert(companySettings).values({ companyId: `${id}-co`, businessType: "both" });
}

let eventSeq = 0;
function subscriptionEvent(
  type: string,
  input: { tenantId: string; id?: string; status?: string; modules?: string[]; created: number; customer?: string; kind?: "plan" | "modules"; requestedModules?: string[] },
): Stripe.Event {
  eventSeq += 1;
  const codes = [...(input.kind === "modules" ? [] : ["base"]), ...(input.modules ?? []).map((moduleId) => `module:${moduleId}`)];
  const items = codes.map((code, index) => ({
    id: `si_${index}`,
    current_period_end: input.created + 30 * 86_400,
    price: { id: `price_${code}`, metadata: { code } },
  }));
  return {
    id: `evt_${eventSeq}`,
    type,
    created: input.created,
    data: { object: { id: input.id ?? `sub_${input.tenantId}`, customer: input.customer ?? `cus_${input.tenantId}`, status: input.status ?? "active", cancel_at_period_end: false, metadata: { tenantId: input.tenantId, ...(input.kind ? { kind: input.kind } : {}), ...(input.requestedModules ? { modules: input.requestedModules.join(",") } : {}) }, items: { data: items } } },
  } as unknown as Stripe.Event;
}

const handle = (event: Stripe.Event, deps: WebhookDeps = {}) => state.db.transaction((tx: never) => handleStripeEvent(event, tx, deps));
const subscriptionOf = async (tenantId: string) => (await state.db.select().from(subscription).where(eq(subscription.tenantId, tenantId)))[0];
const now = Math.floor(Date.now() / 1000);

describe("webhook de suscripciones", () => {
  it("al contratar guarda el plan, los módulos de sus líneas y el fin del periodo; un duplicado no se reaplica", async () => {
    await createTenant("t1", new Date(Date.now() - 86_400_000));
    const event = subscriptionEvent("customer.subscription.created", { tenantId: "t1", modules: ["banking", "pos"], created: now });
    expect(await handle(event)).toBe("processed");
    expect(await handle(event)).toBe("duplicate");
    const row = await subscriptionOf("t1");
    expect(row).toMatchObject({ status: "ACTIVE", plan: "base", addons: ["banking", "pos"], stripeSubscriptionId: "sub_t1" });
    expect(row.currentPeriodEndsAt).toBeInstanceOf(Date);
  });

  it("descarta un evento más antiguo que el último aplicado y refleja cambios de módulos hechos en el portal", async () => {
    expect(await handle(subscriptionEvent("customer.subscription.updated", { tenantId: "t1", modules: ["crm"], created: now - 60 }))).toBe("stale");
    expect(await handle(subscriptionEvent("customer.subscription.updated", { tenantId: "t1", modules: ["banking"], created: now + 60 }))).toBe("processed");
    expect((await subscriptionOf("t1")).addons).toEqual(["banking"]);
  });

  it("el final de una suscripción antigua no pisa la vigente", async () => {
    expect(await handle(subscriptionEvent("customer.subscription.deleted", { tenantId: "t1", id: "sub_old", created: now + 120 }))).toBe("ignored");
    expect((await subscriptionOf("t1")).status).toBe("ACTIVE");
  });

  it("impago: guarda desde cuándo y deja trabajar durante la gracia; al cancelarse pasa a solo lectura", async () => {
    await handle(subscriptionEvent("customer.subscription.updated", { tenantId: "t1", status: "past_due", modules: ["banking"], created: now + 180 }));
    const row = await subscriptionOf("t1");
    expect(row.status).toBe("PAST_DUE");
    expect(row.pastDueSince).toBeInstanceOf(Date);
    expect((await getTenantBillingAccess("t1")).state).toBe("grace");
    await handle(subscriptionEvent("customer.subscription.deleted", { tenantId: "t1", created: now + 240 }));
    expect(await subscriptionOf("t1")).toMatchObject({ status: "CANCELED", plan: "free", pastDueSince: null });
  });
});

describe("plan anual y módulos en su propia suscripción mensual", () => {
  it("al activarse el plan crea la suscripción de los módulos elegidos (una sola vez)", async () => {
    await createTenant("t4", new Date(Date.now() - 86_400_000));
    const createModulesSubscription = vi.fn(async () => undefined);
    const plan = (created: number) => subscriptionEvent("customer.subscription.updated", { tenantId: "t4", id: "sub_plan_t4", kind: "plan", requestedModules: ["crm", "pos"], created });
    expect(await handle(plan(now), { createModulesSubscription })).toBe("processed");
    expect(createModulesSubscription).toHaveBeenCalledWith({ tenantId: "t4", customerId: "cus_t4", planSubscriptionId: "sub_plan_t4", modules: ["crm", "pos"], idempotencyKey: "modules-from-plan-sub_plan_t4" });
    expect(await subscriptionOf("t4")).toMatchObject({ status: "ACTIVE", plan: "base", addons: [] });

    // La suscripción de módulos llega por su propio evento y solo toca los módulos.
    expect(await handle(subscriptionEvent("customer.subscription.created", { tenantId: "t4", id: "sub_mod_t4", kind: "modules", modules: ["crm", "pos"], created: now + 10 }))).toBe("processed");
    expect(await subscriptionOf("t4")).toMatchObject({ stripeSubscriptionId: "sub_plan_t4", stripeModulesSubscriptionId: "sub_mod_t4", modulesStatus: "ACTIVE", addons: ["crm", "pos"], status: "ACTIVE" });

    // Un nuevo aviso del plan no vuelve a crearla ni borra los módulos.
    await handle(plan(now + 20), { createModulesSubscription });
    expect(createModulesSubscription).toHaveBeenCalledTimes(1);
    expect((await subscriptionOf("t4")).addons).toEqual(["crm", "pos"]);
  });

  it("los módulos pendientes de pago no se activan; al cancelar su suscripción se quitan", async () => {
    await handle(subscriptionEvent("customer.subscription.updated", { tenantId: "t4", id: "sub_mod_t4", kind: "modules", status: "incomplete", modules: ["crm", "pos"], created: now + 30 }));
    expect(await subscriptionOf("t4")).toMatchObject({ modulesStatus: "INCOMPLETE", addons: [], stripeModulesSubscriptionId: "sub_mod_t4" });
    await handle(subscriptionEvent("customer.subscription.deleted", { tenantId: "t4", id: "sub_mod_t4", kind: "modules", modules: ["crm", "pos"], created: now + 40 }));
    expect(await subscriptionOf("t4")).toMatchObject({ modulesStatus: null, addons: [], stripeModulesSubscriptionId: null, status: "ACTIVE", plan: "base" });
  });

  it("si termina el plan, se cancela también la suscripción de módulos", async () => {
    await handle(subscriptionEvent("customer.subscription.created", { tenantId: "t4", id: "sub_mod2_t4", kind: "modules", modules: ["crm"], created: now + 50 }));
    const cancelModulesSubscription = vi.fn(async () => undefined);
    await handle(subscriptionEvent("customer.subscription.deleted", { tenantId: "t4", id: "sub_plan_t4", kind: "plan", created: now + 60 }), { cancelModulesSubscription });
    expect(cancelModulesSubscription).toHaveBeenCalledWith("sub_mod2_t4");
    expect(await subscriptionOf("t4")).toMatchObject({ status: "CANCELED", plan: "free" });
  });
});

describe("créditos de lectura con IA", () => {
  it("la compra suma una sola vez aunque Stripe repita el aviso; solo cuando está pagada", async () => {
    await createTenant("t2", new Date(Date.now() + 86_400_000));
    const checkout = (id: string, paymentStatus: string) => ({
      id: `evt_${id}`,
      type: "checkout.session.completed",
      created: now,
      data: { object: { id: `cs_${id}`, payment_status: paymentStatus, metadata: { kind: "ocr-credits", tenantId: "t2", credits: "100", packCode: "ocr-100" } } },
    }) as unknown as Stripe.Event;
    expect(await handle(checkout("unpaid", "unpaid"))).toBe("ignored");
    expect(await handle(checkout("a", "paid"))).toBe("processed");
    await handle({ ...checkout("a", "paid"), id: "evt_a2" } as Stripe.Event);
    expect(await getOcrCreditBalance("t2")).toBe(100);
  });

  it("cada lectura descuenta según su coste real, una vez por documento, y sin saldo no se puede leer", async () => {
    const usage = { model: "gpt-6-luna", inputTokens: 6_000, cachedInputTokens: 0, outputTokens: 2_000 };
    expect(await chargeOcrUsage({ tenantId: "t2", companyId: "t2-co", ocrJobId: "job-1", fileName: "f.pdf", usage })).toBe(1);
    await chargeOcrUsage({ tenantId: "t2", companyId: "t2-co", ocrJobId: "job-1", fileName: "f.pdf", usage });
    expect(await chargeOcrUsage({ tenantId: "t2", companyId: "t2-co", ocrJobId: "job-2", fileName: "largo.pdf", usage: { ...usage, inputTokens: 60_000, outputTokens: 6_000 } })).toBe(5);
    expect(await getOcrCreditBalance("t2")).toBe(94);
    await expect(assertOcrCreditsAvailable("t2", 95)).rejects.toMatchObject({ status: 402 });
    await expect(assertOcrCreditsAvailable("t2", 94)).resolves.toBeUndefined();
  });
});

describe("módulos según el plan", () => {
  it("en prueba se usa todo; con suscripción, solo lo contratado; activar uno no contratado pide añadirlo (402)", async () => {
    await createTenant("t3", new Date(Date.now() + 86_400_000));
    expect(await isModuleEnabled("t3-co", "banking")).toBe(true);
    await state.db.insert(subscription).values({ tenantId: "t3", plan: "base", status: "ACTIVE", addons: ["crm"], stripeSubscriptionId: "sub_t3" });
    await setCompanyModule({ tenantId: "t3", companyId: "t3-co", actorUserId: USER, moduleId: "crm", enabled: true });
    const states = await listModuleStates("t3-co");
    expect(states.find((entry) => entry.id === "crm")).toMatchObject({ enabled: true, inPlan: true });
    // Banca venía activada por defecto, pero no está contratada: no se puede usar.
    expect(states.find((entry) => entry.id === "banking")).toMatchObject({ enabled: false, inPlan: false, selected: true });
    await expect(setCompanyModule({ tenantId: "t3", companyId: "t3-co", actorUserId: USER, moduleId: "pos", enabled: true })).rejects.toMatchObject({ status: 402 });
  });
});
