import { describe, expect, it } from "vitest";

import { planImport, planReferenceImport } from "@/lib/bank-import/dedupe";
import type { ImportedMovement } from "@/lib/bank-import/types";

const day = new Date(Date.UTC(2026, 8, 5));

function movement(line: number, amount: number, description: string, balanceAfter: number | null = null): ImportedMovement {
  return { line, postedAt: day, valueDate: null, amount, description, reference: null, balanceAfter };
}

describe("duplicate detection on import", () => {
  it("keeps legit identical same-day charges inside one file", () => {
    const plan = planImport([], [movement(2, -294, "RECIBO TGSS"), movement(3, -294, "RECIBO TGSS")]);
    expect(plan.toInsert).toHaveLength(2);
    expect(plan.duplicates).toEqual([]);
  });

  it("only skips as many identical rows as were already stored (overlapping statements)", () => {
    const existing = [{ postedAt: day, amount: "-294.00", description: "RECIBO TGSS" }];
    const plan = planImport(existing, [movement(2, -294, "RECIBO TGSS"), movement(3, -294, "recibo  tgss"), movement(4, 10, "Otro")]);
    expect(plan.toInsert.map((row) => row.line)).toEqual([3, 4]);
    expect(plan.duplicates).toEqual([{ line: 2, reason: "Ya estaba importado (misma fecha, importe y concepto)." }]);
  });

  it("uses the balance after each movement to tell identical charges apart", () => {
    const existing = [{ postedAt: day, amount: "-294.00", description: "RECIBO TGSS", balanceAfter: "15903.50" }];
    const plan = planImport(existing, [movement(2, -294, "RECIBO TGSS", 15903.5), movement(3, -294, "RECIBO TGSS", 15609.5)]);
    expect(plan.toInsert.map((row) => row.line)).toEqual([3]);
    expect(plan.duplicates.map((row) => row.line)).toEqual([2]);
  });

  it("re-importing the same file twice imports nothing the second time", () => {
    const rows = [movement(2, -12.5, "COMISION", 100), movement(3, -12.5, "COMISION", 87.5)];
    const stored = rows.map((row) => ({ postedAt: row.postedAt, amount: row.amount, description: row.description, balanceAfter: row.balanceAfter }));
    expect(planImport(stored, rows).toInsert).toEqual([]);
  });
});

describe("duplicate detection by bank transaction id (PSD2 sync)", () => {
  const withReference = (line: number, reference: string | null) => ({ ...movement(line, -294, "RECIBO TGSS"), reference });

  it("keeps identical same-day movements with different bank ids and skips the ones already synced", () => {
    const plan = planReferenceImport(["tx-1"], [withReference(1, "tx-1"), withReference(2, "tx-2"), withReference(3, "tx-3")]);
    expect(plan.toInsert.map((row) => row.reference)).toEqual(["tx-2", "tx-3"]);
    expect(plan.duplicates).toEqual([{ line: 1, reason: "Ya estaba sincronizado." }]);
  });

  it("skips repeated ids inside the same batch and movements without id", () => {
    const plan = planReferenceImport([], [withReference(1, "tx-9"), withReference(2, "tx-9"), withReference(3, null)]);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.duplicates.map((row) => row.line)).toEqual([2, 3]);
  });
});
