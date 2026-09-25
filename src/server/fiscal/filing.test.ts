import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

import { composeFiscalPeriod, fiscalPeriodPartsFor, splitFiscalPeriod } from "@/lib/fiscal-spain";
import { formatAeatAmount } from "@/lib/format";
import { normalizeMarkFiledPayload } from "@/server/fiscal/service";

const now = new Date("2026-04-15T10:00:00.000Z");

describe("presentación de modelos", () => {
  it("normaliza justificante y NRC y acepta la fecha de hoy", () => {
    expect(normalizeMarkFiledPayload({ filedAt: new Date("2026-04-15T12:00:00.000Z"), receiptNumber: " 3030 1234 56789 ", nrc: "abc1234567890" }, now)).toEqual({
      data: { filedAt: new Date("2026-04-15T12:00:00.000Z"), receiptNumber: "3030123456789", nrc: "ABC1234567890" },
    });
    expect(normalizeMarkFiledPayload({ filedAt: new Date("2026-04-10T12:00:00.000Z"), receiptNumber: "3030123456789", nrc: "" }, now)).toMatchObject({ data: { nrc: null } });
  });

  it("rechaza fechas futuras, justificantes vacíos o raros y NRC cortos", () => {
    expect(normalizeMarkFiledPayload({ filedAt: new Date("2026-04-16T12:00:00.000Z"), receiptNumber: "3030123456789" }, now)).toEqual({ error: "La fecha de presentación no puede ser futura." });
    expect(normalizeMarkFiledPayload({ filedAt: new Date("2026-04-10T12:00:00.000Z"), receiptNumber: "12" }, now)).toHaveProperty("error");
    expect(normalizeMarkFiledPayload({ filedAt: new Date("2026-04-10T12:00:00.000Z"), receiptNumber: "3030123456789", nrc: "123" }, now)).toHaveProperty("error");
  });

  it("compone y separa el periodo desde los selectores de año y trimestre/mes", () => {
    expect(fiscalPeriodPartsFor("390")).toEqual([]);
    expect(fiscalPeriodPartsFor("130").map((part) => part.value)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(fiscalPeriodPartsFor("303")).toHaveLength(16);
    expect(composeFiscalPeriod(2026, "Q2")).toBe("2026-Q2");
    expect(composeFiscalPeriod(2026, null)).toBe("2026");
    expect(splitFiscalPeriod("2026-04")).toEqual({ year: 2026, part: "04" });
    expect(splitFiscalPeriod("2026")).toEqual({ year: 2026, part: null });
    expect(splitFiscalPeriod("mal")).toEqual({ year: null, part: null });
  });

  it("copia los importes como los pide la AEAT", () => {
    expect(formatAeatAmount(1234.5)).toBe("1234,50");
    expect(formatAeatAmount("-0.1")).toBe("-0,10");
  });
});
