import { describe, expect, it, vi } from "vitest";

import { checkVatNumber, splitVatNumber, VIES_ENDPOINT } from "@/server/vies/client";

const now = () => new Date("2026-09-25T10:00:00.000Z");

function fakeFetch(response: { ok?: boolean; status?: number; body?: unknown } | Error) {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return { ok: response.ok ?? true, status: response.status ?? 200, json: async () => response.body };
  });
}

describe("VIES (siempre simulado en tests)", () => {
  it("separa prefijo y número; Grecia usa EL", () => {
    expect(splitVatNumber("FR", "fr 12 345678901")).toEqual({ prefix: "FR", number: "12345678901" });
    expect(splitVatNumber("GR", "123456789")).toEqual({ prefix: "EL", number: "123456789" });
  });

  it("NIF-IVA válido: guarda nombre y fecha", async () => {
    const fetchImpl = fakeFetch({ body: { isValid: true, name: "ACME SARL", address: "1 rue X" } });
    const result = await checkVatNumber("FR", "FR12345678901", { fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledWith(`${VIES_ENDPOINT}/FR/vat/12345678901`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result).toMatchObject({ status: "VALID", name: "ACME SARL", vatNumber: "FR12345678901" });
    expect(result.checkedAt.toISOString()).toBe("2026-09-25T10:00:00.000Z");
  });

  it("NIF-IVA no válido", async () => {
    const result = await checkVatNumber("DE", "DE123456789", { fetchImpl: fakeFetch({ body: { isValid: false, name: "---" } }), now });
    expect(result).toMatchObject({ status: "INVALID", name: null });
    expect(result.message).toContain("IVA español");
  });

  it("VIES caído, error HTTP o tiempo agotado: UNAVAILABLE sin lanzar", async () => {
    expect((await checkVatNumber("IT", "IT12345678901", { fetchImpl: fakeFetch({ ok: false, status: 503 }), now })).status).toBe("UNAVAILABLE");
    expect((await checkVatNumber("IT", "IT12345678901", { fetchImpl: fakeFetch({ body: { userError: "MS_UNAVAILABLE" } }), now })).status).toBe("UNAVAILABLE");
    expect((await checkVatNumber("IT", "IT12345678901", { fetchImpl: fakeFetch(new Error("abort")), now })).status).toBe("UNAVAILABLE");
    const hanging = vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    expect((await checkVatNumber("IT", "IT12345678901", { fetchImpl: hanging, timeoutMs: 5, now })).status).toBe("UNAVAILABLE");
  });

  it("no consulta VIES para España ni países fuera de la UE", async () => {
    const fetchImpl = fakeFetch({ body: { isValid: true } });
    expect((await checkVatNumber("ES", "B12345674", { fetchImpl, now })).status).toBe("UNAVAILABLE");
    expect((await checkVatNumber("US", "123", { fetchImpl, now })).status).toBe("UNAVAILABLE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
