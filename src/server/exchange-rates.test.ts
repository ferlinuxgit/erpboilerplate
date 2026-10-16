import { describe, expect, it, vi } from "vitest";

import { ecbExchangeRate } from "@/server/exchange-rates";

describe("ecbExchangeRate", () => {
  it("asks the ECB for the invoice day and returns the published day", async () => {
    const fetcher = vi.fn(async (_url: string) => Response.json({ amount: 1, base: "USD", date: "2026-10-02", rates: { EUR: 0.89087 } }));
    const rate = await ecbExchangeRate({ from: "usd", to: "EUR", date: "2026-10-04" }, fetcher as unknown as typeof fetch);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.frankfurter.dev/v1/2026-10-04?base=USD&symbols=EUR");
    expect(rate).toEqual({ from: "USD", to: "EUR", rate: 0.89087, rateDate: "2026-10-02", source: "BCE" });
    // Los días pasados se guardan: no se vuelve a consultar.
    await ecbExchangeRate({ from: "USD", to: "EUR", date: "2026-10-04" }, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown currencies without calling the ECB", async () => {
    const fetcher = vi.fn();
    await expect(ecbExchangeRate({ from: "dolar", to: "EUR", date: "2026-10-04" }, fetcher as unknown as typeof fetch)).rejects.toThrow(/Moneda/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
