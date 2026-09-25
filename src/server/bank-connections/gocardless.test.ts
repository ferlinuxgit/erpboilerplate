import { afterEach, describe, expect, it, vi } from "vitest";

import { bankSyncIntervalHours, getBankConnectionsConfig, GOCARDLESS_DEFAULT_BASE_URL } from "@/lib/bank-connections-config";
import { decryptSecret, encryptSecret } from "@/server/bank-connections/crypto";
import { clearGoCardlessTokenCache, GoCardlessClient, GoCardlessError } from "@/server/bank-connections/gocardless";
import { connectionStatusFromRequisition, consentDaysLeft, mapBookedTransactions, syncDateFrom, transactionReference } from "@/server/bank-connections/mapping";

const config = { secretId: "secret-id", secretKey: "secret-key", baseUrl: "https://gc.test/api/v2" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** fetch simulado: responde por ruta y registra cada llamada (nunca sale a la red). */
function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.replace(config.baseUrl, "");
    const key = Object.keys(routes).find((route) => path.startsWith(route));
    if (!key) return json({ summary: "Not found" }, 404);
    return routes[key](init);
  });
  return { impl, calls };
}

afterEach(() => {
  clearGoCardlessTokenCache();
});

describe("GoCardless Bank Account Data client", () => {
  it("gets an access token once, sends it as bearer and caches it", async () => {
    const { impl, calls } = fakeFetch({
      "/token/new/": () => json({ access: "access-1", access_expires: 86400, refresh: "refresh-1", refresh_expires: 2592000 }),
      "/institutions/": () => json([{ id: "SANTANDER_BSCHESMM", name: "Santander" }]),
    });
    const client = new GoCardlessClient(config, { fetchImpl: impl, now: () => 1_000_000 });
    await client.listInstitutions("ES");
    await client.listInstitutions("ES");
    expect(calls.filter((call) => call.url.endsWith("/token/new/"))).toHaveLength(1);
    const tokenBody = JSON.parse(String(calls[0].init?.body));
    expect(tokenBody).toEqual({ secret_id: "secret-id", secret_key: "secret-key" });
    const institutionCall = calls[1];
    expect(institutionCall.url).toBe("https://gc.test/api/v2/institutions/?country=es");
    expect((institutionCall.init?.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
  });

  it("refreshes an expired access token with the refresh token", async () => {
    let now = 0;
    const { impl, calls } = fakeFetch({
      "/token/new/": () => json({ access: "access-1", access_expires: 60 * 60, refresh: "refresh-1", refresh_expires: 30 * 86400 }),
      "/token/refresh/": () => json({ access: "access-2", access_expires: 60 * 60 }),
      "/requisitions/": () => json({ id: "req-1", status: "LN", accounts: ["acc-1"] }),
    });
    const client = new GoCardlessClient(config, { fetchImpl: impl, now: () => now });
    await client.getRequisition("req-1");
    now = 2 * 3_600_000;
    await client.getRequisition("req-1");
    const refresh = calls.find((call) => call.url.endsWith("/token/refresh/"));
    expect(JSON.parse(String(refresh?.init?.body))).toEqual({ refresh: "refresh-1" });
    expect((calls.at(-1)?.init?.headers as Record<string, string>).Authorization).toBe("Bearer access-2");
  });

  it("creates the end-user agreement (read-only scopes) and the requisition with the redirect", async () => {
    const { impl, calls } = fakeFetch({
      "/token/new/": () => json({ access: "a", access_expires: 86400, refresh: "r", refresh_expires: 2592000 }),
      "/agreements/enduser/": () => json({ id: "agr-1", max_historical_days: 90, access_valid_for_days: 90 }, 201),
      "/requisitions/": () => json({ id: "req-1", status: "CR", link: "https://ob.gocardless.com/psd2/start/req-1", accounts: [] }, 201),
    });
    const client = new GoCardlessClient(config, { fetchImpl: impl });
    await client.createAgreement({ institutionId: "BBVA_BBVAESMM", maxHistoricalDays: 90, accessValidForDays: 90 });
    const requisition = await client.createRequisition({ institutionId: "BBVA_BBVAESMM", agreementId: "agr-1", redirect: "https://erp.test/treasury/bank-connections/callback", reference: "conn-1.1" });
    expect(requisition.link).toContain("ob.gocardless.com");
    const agreementBody = JSON.parse(String(calls[1].init?.body));
    expect(agreementBody).toEqual({ institution_id: "BBVA_BBVAESMM", max_historical_days: 90, access_valid_for_days: 90, access_scope: ["balances", "details", "transactions"] });
    const requisitionBody = JSON.parse(String(calls[2].init?.body));
    expect(requisitionBody).toMatchObject({ redirect: "https://erp.test/treasury/bank-connections/callback", agreement: "agr-1", reference: "conn-1.1", user_language: "ES" });
  });

  it("reads booked transactions with date_from and raises typed errors (expired consent, rate limit)", async () => {
    const { impl, calls } = fakeFetch({
      "/token/new/": () => json({ access: "a", access_expires: 86400, refresh: "r", refresh_expires: 2592000 }),
      "/accounts/acc-1/transactions/": () => json({ transactions: { booked: [], pending: [] } }),
      "/accounts/acc-2/transactions/": () => json({ summary: "End User Agreement (EUA) expired", detail: "EUA has expired" }, 401),
      "/accounts/acc-3/transactions/": () => json({ summary: "Rate limit exceeded" }, 429),
    });
    const client = new GoCardlessClient(config, { fetchImpl: impl });
    await client.getAccountTransactions("acc-1", "2026-09-01");
    expect(calls[1].url).toBe("https://gc.test/api/v2/accounts/acc-1/transactions/?date_from=2026-09-01");
    const expired = await client.getAccountTransactions("acc-2").catch((error: unknown) => error);
    expect(expired).toBeInstanceOf(GoCardlessError);
    expect((expired as GoCardlessError).consentExpired).toBe(true);
    const limited = await client.getAccountTransactions("acc-3").catch((error: unknown) => error);
    expect((limited as GoCardlessError).rateLimited).toBe(true);
  });
});

describe("booked transactions mapping", () => {
  it("maps booked movements to the import format, using the bank transactionId as reference", () => {
    const { movements, skipped } = mapBookedTransactions([
      { transactionId: "tx-1", bookingDate: "2026-09-20", valueDate: "2026-09-21", transactionAmount: { amount: "-45.30", currency: "EUR" }, remittanceInformationUnstructured: "RECIBO LUZ SEPTIEMBRE", creditorName: "Eléctrica SA", balanceAfterTransaction: { balanceAmount: { amount: "1000.10", currency: "EUR" } } },
      { internalTransactionId: "int-2", bookingDate: "2026-09-21", transactionAmount: { amount: "1210.00", currency: "EUR" }, remittanceInformationUnstructuredArray: ["TRANSFERENCIA", "F-2026-0042"], debtorName: "Cliente Ejemplo SA" },
      { transactionId: "tx-3", bookingDate: "2026-09-22", transactionAmount: { amount: "10.00", currency: "USD" } },
      { transactionId: "tx-4", transactionAmount: { amount: "5.00", currency: "EUR" } },
    ]);
    expect(skipped).toBe(2);
    expect(movements[0]).toEqual({
      line: 1,
      postedAt: new Date("2026-09-20T00:00:00.000Z"),
      valueDate: new Date("2026-09-21T00:00:00.000Z"),
      amount: -45.3,
      description: "Eléctrica SA · RECIBO LUZ SEPTIEMBRE",
      reference: "tx-1",
      balanceAfter: 1000.1,
    });
    expect(movements[1]).toMatchObject({ reference: "int-2", amount: 1210, description: "Cliente Ejemplo SA · TRANSFERENCIA · F-2026-0042", balanceAfter: null });
  });

  it("falls back to a stable fingerprint when the bank gives no id", () => {
    const transaction = { bookingDate: "2026-09-20", transactionAmount: { amount: "-1.00", currency: "EUR" }, remittanceInformationUnstructured: "COMISION" };
    expect(transactionReference(transaction)).toMatch(/^gc:[0-9a-f]{32}$/);
    expect(transactionReference(transaction)).toBe(transactionReference({ ...transaction }));
  });

  it("computes consent days left, sync start dates and requisition statuses", () => {
    const now = new Date("2026-09-25T12:00:00.000Z");
    expect(consentDaysLeft(new Date("2026-10-05T12:00:00.000Z"), now)).toBe(10);
    expect(consentDaysLeft(null, now)).toBeNull();
    expect(syncDateFrom({ now, historyDays: 90, lastBookingDate: null, lastOtherSourceDate: null })).toBe("2026-06-27");
    expect(syncDateFrom({ now, historyDays: 90, lastBookingDate: new Date("2026-09-20T00:00:00.000Z"), lastOtherSourceDate: null })).toBe("2026-09-17");
    expect(syncDateFrom({ now, historyDays: 90, lastBookingDate: null, lastOtherSourceDate: new Date("2026-09-10T00:00:00.000Z") })).toBe("2026-09-11");
    expect(connectionStatusFromRequisition("LN")).toBe("LINKED");
    expect(connectionStatusFromRequisition("EX")).toBe("EXPIRED");
    expect(connectionStatusFromRequisition("RJ")).toBe("REVOKED");
    expect(connectionStatusFromRequisition("CR")).toBe("PENDING");
  });
});

describe("configuration and secrets", () => {
  it("is disabled without GoCardless credentials and reads the sync interval", () => {
    expect(getBankConnectionsConfig({ JWT_SECRET: "x".repeat(32) })).toBeNull();
    const enabled = getBankConnectionsConfig({ GOCARDLESS_SECRET_ID: "id", GOCARDLESS_SECRET_KEY: "key", JWT_SECRET: "x".repeat(32), APP_URL: "https://erp.test/" });
    expect(enabled).toMatchObject({ baseUrl: GOCARDLESS_DEFAULT_BASE_URL, appUrl: "https://erp.test", syncIntervalHours: 6 });
    expect(bankSyncIntervalHours({ BANK_SYNC_INTERVAL_HOURS: "12" })).toBe(12);
    expect(bankSyncIntervalHours({ BANK_SYNC_INTERVAL_HOURS: "abc" })).toBe(6);
  });

  it("encrypts provider ids at rest (AES-256-GCM) and detects tampering or a different key", () => {
    const encrypted = encryptSecret("req-123", "secret-a");
    expect(encrypted).not.toContain("req-123");
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptSecret(encrypted, "secret-a")).toBe("req-123");
    expect(encryptSecret("req-123", "secret-a")).not.toBe(encrypted);
    expect(() => decryptSecret(encrypted, "secret-b")).toThrow();
    const [version, iv, tag, data] = encrypted.split(".");
    const tampered = [version, iv, tag, `${data.slice(0, -2)}AA`].join(".");
    expect(() => decryptSecret(tampered, "secret-a")).toThrow();
  });
});
