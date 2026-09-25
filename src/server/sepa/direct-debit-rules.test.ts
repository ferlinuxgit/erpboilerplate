import { describe, expect, it } from "vitest";

import {
  earliestCollectionDate,
  isValidMandateReference,
  mandateAfterCollection,
  mandateExpiresAt,
  mandateUnusableReason,
  nextSequenceType,
  proposeMandateReference,
} from "@/server/sepa/direct-debit-rules";

const signed = new Date("2025-01-10T00:00:00.000Z");
const active = { mandateType: "RECURRENT", status: "ACTIVE", collectionCount: 0, signatureDate: signed, lastCollectionAt: null };

describe("secuencia de los adeudos", () => {
  it("FRST el primero, RCUR los siguientes (contando los que ya van en remesas pendientes) y OOFF si es de un solo uso", () => {
    expect(nextSequenceType(active)).toBe("FRST");
    expect(nextSequenceType(active, 1)).toBe("RCUR");
    expect(nextSequenceType({ ...active, collectionCount: 3 })).toBe("RCUR");
    expect(nextSequenceType({ ...active, mandateType: "ONE_OFF" })).toBe("OOFF");
  });

  it("al cobrar suma un uso y al devolver lo resta: un FRST devuelto vuelve a ser FRST", () => {
    const collected = mandateAfterCollection({ collectionCount: 0, firstCollectionAt: null, lastCollectionAt: null, status: "ACTIVE" }, "FRST", 1, new Date("2026-02-01T00:00:00.000Z"), new Date());
    expect(collected).toMatchObject({ collectionCount: 1, firstCollectionAt: new Date("2026-02-01T00:00:00.000Z"), status: "ACTIVE" });
    const returned = mandateAfterCollection({ ...collected, status: "ACTIVE" }, "FRST", -1, new Date("2026-02-01T00:00:00.000Z"), new Date());
    expect(returned).toMatchObject({ collectionCount: 0, firstCollectionAt: null, lastCollectionAt: null });
    expect(nextSequenceType({ ...active, collectionCount: returned.collectionCount })).toBe("FRST");
  });

  it("un mandato de un solo uso se cierra al cobrarlo y se reabre si se devuelve", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const used = mandateAfterCollection({ collectionCount: 0, firstCollectionAt: null, lastCollectionAt: null, status: "ACTIVE" }, "OOFF", 1, now, now);
    expect(used).toMatchObject({ status: "REVOKED", revokedAt: now });
    expect(mandateAfterCollection({ ...used, status: "REVOKED" }, "OOFF", -1, now, now)).toMatchObject({ status: "ACTIVE", revokedAt: null });
  });
});

describe("validez del mandato", () => {
  it("caduca a los 36 meses sin uso", () => {
    expect(mandateExpiresAt(active).toISOString().slice(0, 10)).toBe("2028-01-10");
    expect(mandateUnusableReason(active, new Date("2028-02-01T00:00:00.000Z"))).toMatch(/caducado/);
    expect(mandateUnusableReason({ ...active, lastCollectionAt: new Date("2027-06-01T00:00:00.000Z"), collectionCount: 2 }, new Date("2028-02-01T00:00:00.000Z"))).toBeNull();
  });

  it("rechaza revocados, firmados después del cobro y únicos ya usados", () => {
    expect(mandateUnusableReason({ ...active, status: "REVOKED" }, new Date("2026-01-01T00:00:00.000Z"))).toMatch(/revocado/);
    expect(mandateUnusableReason(active, new Date("2024-12-01T00:00:00.000Z"))).toMatch(/después/);
    expect(mandateUnusableReason({ ...active, mandateType: "ONE_OFF" }, new Date("2026-01-01T00:00:00.000Z"), 1)).toMatch(/único/);
  });
});

describe("fechas y referencias", () => {
  it("el cobro es como pronto el siguiente día hábil", () => {
    expect(earliestCollectionDate(new Date("2026-09-25T18:00:00.000Z")).toISOString().slice(0, 10)).toBe("2026-09-28"); // viernes → lunes
    expect(earliestCollectionDate(new Date("2026-09-22T08:00:00.000Z")).toISOString().slice(0, 10)).toBe("2026-09-23");
  });

  it("propone referencias válidas de mandato", () => {
    const reference = proposeMandateReference("Muñoz & Hijos, S.L.", new Date("2026-09-25T00:00:00.000Z"), "abcd1234-0000");
    expect(reference).toBe("MDT-MUNOZHIJOS,S-20260925-ABCD");
    expect(isValidMandateReference(reference)).toBe(true);
    expect(isValidMandateReference("con espacio")).toBe(false);
    expect(isValidMandateReference("X".repeat(36))).toBe(false);
  });
});
