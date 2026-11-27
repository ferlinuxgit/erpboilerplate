import { describe, expect, it } from "vitest";

import { assertFiscalPeriodOpen, assertOperationDatePeriodOpen, findFiscalPeriodLock, fiscalYearEndExclusive, FiscalPeriodLockedError } from "@/server/fiscal/locks";

function dbWithReports(reports: Array<{ id: string; code: string; period: string }>) {
  return {
    select: () => ({
      from: () => ({
        where: async () => reports,
      }),
    }),
  };
}

describe("fiscal period locks", () => {
  it("locks dates covered by filed Spanish fiscal reports", async () => {
    const lock = await findFiscalPeriodLock(
      "company-1",
      new Date(Date.UTC(2026, 1, 15)),
      dbWithReports([{ id: "report-1", code: "303", period: "2026-Q1" }]) as never,
    );

    expect(lock).toEqual({ locked: true, reportId: "report-1", code: "303", period: "2026-Q1" });
  });

  it("ignores dates outside filed report ranges", async () => {
    const lock = await findFiscalPeriodLock(
      "company-1",
      new Date(Date.UTC(2026, 4, 1)),
      dbWithReports([{ id: "report-1", code: "303", period: "2026-Q1" }]) as never,
    );

    expect(lock).toEqual({ locked: false });
  });

  it("treats the fiscal year end date as a full day (31/12 afternoon still belongs to the year)", () => {
    expect(fiscalYearEndExclusive(new Date(Date.UTC(2026, 11, 31)))).toEqual(new Date(Date.UTC(2027, 0, 1)));
  });

  it("raises a 409 domain error with a Spanish message for filed periods", async () => {
    let selectCall = 0;
    const client = {
      select: () => {
        selectCall += 1;
        const isYearQuery = selectCall % 2 === 1;
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.where = () => (isYearQuery ? chain : Promise.resolve([{ id: "report-1", code: "303", period: "2026-Q1" }]));
        chain.limit = async () => [{ code: "2026", isClosed: false }];
        return chain;
      },
    };
    await expect(assertFiscalPeriodOpen("company-1", new Date(Date.UTC(2026, 1, 15)), client as never)).rejects.toBeInstanceOf(FiscalPeriodLockedError);
    await expect(assertFiscalPeriodOpen("company-1", new Date(Date.UTC(2026, 1, 15)), client as never)).rejects.toMatchObject({ status: 409 });
  });
});

describe("bloqueo de periodos en hora local", () => {
  const q1Filed = dbWithReports([{ id: "report-1", code: "303", period: "2026-Q1" }]) as never;

  /** Primera consulta: modelos presentados; segunda (solo en la hora que separa península y Canarias): la empresa. */
  function dbWithCompany(companyRow: { countryCode: string; postalCode: string | null; province: string | null }) {
    let call = 0;
    return {
      select: () => ({
        from: () => ({
          where: async () => {
            call += 1;
            return call % 2 === 1 ? [{ id: "report-1", code: "303", period: "2026-Q1" }] : [companyRow];
          },
        }),
      }),
    } as never;
  }

  it("un ticket del 1 de abril a las 00:30 de Madrid no choca con el primer trimestre presentado", async () => {
    const madrid = dbWithCompany({ countryCode: "ES", postalCode: "28001", province: "Madrid" });
    expect(await findFiscalPeriodLock("company-1", new Date("2026-03-31T22:30:00.000Z"), madrid)).toEqual({ locked: false });
  });

  it("en Canarias ese mismo instante son las 23:30 del 31 de marzo: sigue en el primer trimestre", async () => {
    const canary = dbWithCompany({ countryCode: "ES", postalCode: "35001", province: "Las Palmas" });
    expect((await findFiscalPeriodLock("company-1", new Date("2026-03-31T22:30:00.000Z"), canary)).locked).toBe(true);
  });

  it("las fechas civiles (00:00 UTC) siguen cayendo en su día", async () => {
    expect((await findFiscalPeriodLock("company-1", new Date("2026-03-31T00:00:00.000Z"), q1Filed)).locked).toBe(true);
    expect((await findFiscalPeriodLock("company-1", new Date("2026-04-01T00:00:00.000Z"), q1Filed)).locked).toBe(false);
    expect((await findFiscalPeriodLock("company-1", new Date("2026-01-01T00:00:00.000Z"), q1Filed)).locked).toBe(true);
  });

  it("el 31 de marzo a las 23:30 de Madrid sigue bloqueado", async () => {
    expect((await findFiscalPeriodLock("company-1", new Date("2026-03-31T21:30:00.000Z"), q1Filed)).locked).toBe(true);
  });

  it("puede limitarse a los modelos de IVA: un 111 presentado no bloquea la fecha de operación", async () => {
    const only111 = dbWithReports([{ id: "report-2", code: "111", period: "2026-Q1" }]) as never;
    expect((await findFiscalPeriodLock("company-1", new Date("2026-02-10T00:00:00.000Z"), only111)).locked).toBe(true);
    expect((await findFiscalPeriodLock("company-1", new Date("2026-02-10T00:00:00.000Z"), only111, new Set(["303"]))).locked).toBe(false);
  });
});

describe("fecha de operación en un periodo de IVA presentado", () => {
  const q1Filed = dbWithReports([{ id: "report-1", code: "303", period: "2026-Q1" }]) as never;
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("rechaza una factura de abril con fecha de operación en el primer trimestre ya presentado", async () => {
    await expect(assertOperationDatePeriodOpen("company-1", day("2026-03-20"), day("2026-04-10"), q1Filed)).rejects.toBeInstanceOf(FiscalPeriodLockedError);
    await expect(assertOperationDatePeriodOpen("company-1", day("2026-03-20"), day("2026-04-10"), q1Filed)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("fecha de operación") });
  });

  it("no hace nada sin fecha de operación, si no es anterior a la expedición o si su periodo sigue abierto", async () => {
    await expect(assertOperationDatePeriodOpen("company-1", null, day("2026-04-10"), q1Filed)).resolves.toBeUndefined();
    await expect(assertOperationDatePeriodOpen("company-1", day("2026-04-12"), day("2026-04-10"), q1Filed)).resolves.toBeUndefined();
    await expect(assertOperationDatePeriodOpen("company-1", day("2026-04-05"), day("2026-07-02"), q1Filed)).resolves.toBeUndefined();
    const only111 = dbWithReports([{ id: "report-2", code: "111", period: "2026-Q1" }]) as never;
    await expect(assertOperationDatePeriodOpen("company-1", day("2026-03-20"), day("2026-04-10"), only111)).resolves.toBeUndefined();
  });
});
