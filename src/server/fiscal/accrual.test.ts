import { describe, expect, it } from "vitest";

import { fiscalRangeInstants, parseSpanishFiscalPeriod } from "@/lib/fiscal-spain";
import { resolveAccrualDate, type FiledVatPeriod } from "@/server/fiscal/accrual";

function filed(period: string, snapshotAt: Date | null, code = "303"): FiledVatPeriod {
  const range = parseSpanishFiscalPeriod(period, code as "303");
  if (!range) throw new Error("periodo de prueba no válido");
  return { code, period, ...fiscalRangeInstants(range), snapshotAt };
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("Devengo de las facturas emitidas", () => {
  it("sin fecha de operación manda la fecha de expedición", () => {
    expect(resolveAccrualDate({ issueDate: day("2026-04-05") })).toEqual({ date: day("2026-04-05"), basis: "issue" });
    expect(resolveAccrualDate({ issueDate: day("2026-04-05"), operationDate: null })).toMatchObject({ basis: "issue" });
  });

  it("con fecha de operación anterior manda la operación: una entrega de marzo facturada en abril es del 1T", () => {
    expect(resolveAccrualDate({ issueDate: day("2026-04-05"), operationDate: day("2026-03-31") })).toEqual({ date: day("2026-03-31"), basis: "operation" });
  });

  it("una fecha de operación posterior a la expedición no retrasa el devengo", () => {
    expect(resolveAccrualDate({ issueDate: day("2026-03-28"), operationDate: day("2026-04-05") })).toEqual({ date: day("2026-03-28"), basis: "issue" });
  });

  it("si el periodo de la operación ya está presentado y la factura se emitió después, va al periodo de expedición con aviso", () => {
    const q1 = filed("2026-Q1", new Date("2026-04-15T10:00:00.000Z"));
    const late = resolveAccrualDate({ issueDate: day("2026-05-10"), operationDate: day("2026-03-20"), issuedAt: new Date("2026-05-10T09:00:00.000Z") }, [q1]);
    expect(late).toEqual({ date: day("2026-05-10"), basis: "issue-filed-period", filedPeriod: { code: "303", period: "2026-Q1" } });
  });

  it("si la factura ya existía cuando se presentó el periodo, sigue en el periodo de la operación", () => {
    const q1 = filed("2026-Q1", new Date("2026-04-15T10:00:00.000Z"));
    const before = resolveAccrualDate({ issueDate: day("2026-04-05"), operationDate: day("2026-03-31"), issuedAt: new Date("2026-04-05T08:00:00.000Z") }, [q1]);
    expect(before).toEqual({ date: day("2026-03-31"), basis: "operation" });
  });

  it("un modelo presentado sin foto (anterior a esta versión) conserva el criterio de expedición", () => {
    const q1 = filed("2026-Q1", null);
    const legacy = resolveAccrualDate({ issueDate: day("2026-04-05"), operationDate: day("2026-03-31"), issuedAt: new Date("2026-04-05T08:00:00.000Z") }, [q1]);
    expect(legacy).toMatchObject({ date: day("2026-04-05"), basis: "issue-filed-period" });
  });

  it("no bloquea si expedición y operación están en el mismo periodo presentado", () => {
    const q1 = filed("2026-Q1", null);
    expect(resolveAccrualDate({ issueDate: day("2026-03-20"), operationDate: day("2026-03-10") }, [q1])).toEqual({ date: day("2026-03-10"), basis: "operation" });
    // El 390 anual presentado no impide repartir entre trimestres del mismo año.
    const annual = filed("2026", null, "390");
    expect(resolveAccrualDate({ issueDate: day("2026-04-05"), operationDate: day("2026-03-31") }, [annual])).toMatchObject({ basis: "operation" });
  });

  it("sin momento de emisión (facturas antiguas) compara con la fecha de expedición", () => {
    const q1 = filed("2026-Q1", new Date("2026-04-15T10:00:00.000Z"));
    expect(resolveAccrualDate({ issueDate: day("2026-04-05"), operationDate: day("2026-03-31") }, [q1])).toMatchObject({ basis: "operation" });
    expect(resolveAccrualDate({ issueDate: day("2026-04-20"), operationDate: day("2026-03-31") }, [q1])).toMatchObject({ basis: "issue-filed-period" });
  });
});
