import { describe, expect, it } from "vitest";

import { cashMovementsToSend, cashPeriodOf, planCashMovements, reverseCashMovement, sameCashMovements, siiPaymentMethodCode } from "@/server/sii/cash";

const TZ = "Europe/Madrid";
const day = (iso: string) => new Date(`${iso}T10:00:00Z`);

describe("criterio de caja: medios de cobro y pago (lista L11)", () => {
  it("transferencia 01, domiciliación 05 y el resto «otros» 04", () => {
    expect(siiPaymentMethodCode("BANK_TRANSFER")).toBe("01");
    expect(siiPaymentMethodCode("DIRECT_DEBIT")).toBe("05");
    expect(siiPaymentMethodCode("CARD")).toBe("04");
    expect(siiPaymentMethodCode("CASH")).toBe("04");
    expect(siiPaymentMethodCode(null)).toBe("04");
  });
});

describe("planCashMovements", () => {
  const base = { invoiceId: "inv-1", operationDate: day("2027-03-10"), totalCents: 12_100, timeZone: TZ, now: day("2027-06-01") };

  it("cada cobro con su fecha, importe y medio; la cuenta sin espacios y hasta 34 caracteres", () => {
    const planned = planCashMovements({
      ...base,
      movements: [
        { id: "p2", date: day("2027-05-02"), amountCents: 2_100, method: "04" },
        { id: "p1", date: day("2027-04-01"), amountCents: 10_000, method: "01", account: "ES91 2100 0418 4502 0005 1332" },
      ],
    });
    expect(planned.map((entry) => entry.sourceId)).toEqual(["p1", "p2"]);
    expect(planned[0].movement).toEqual({ date: "01-04-2027", amount: "100.00", method: "01", account: "ES9121000418450200051332" });
    expect(planned[1].movement).toEqual({ date: "02-05-2027", amount: "21.00", method: "04" });
  });

  it("lo cobrado de más no se declara: el último cobro se recorta al total", () => {
    const planned = planCashMovements({ ...base, movements: [{ id: "p1", date: day("2027-04-01"), amountCents: 20_000, method: "01" }, { id: "p2", date: day("2027-04-02"), amountCents: 500, method: "01" }] });
    expect(planned.map((entry) => entry.movement.amount)).toEqual(["121.00"]);
  });

  it("lo pendiente el 31 de diciembre del año siguiente: medio 03 en esa fecha y sin cuenta; los cobros posteriores no cuentan", () => {
    const movements = [
      { id: "p1", date: day("2027-04-01"), amountCents: 2_100, method: "01" as const, account: "ES91" },
      { id: "tarde", date: day("2029-01-10"), amountCents: 10_000, method: "01" as const },
    ];
    // Antes de la fecha límite todavía no se declara el resto.
    expect(planCashMovements({ ...base, movements, now: day("2028-12-30") }).map((entry) => entry.sourceId)).toEqual(["p1"]);
    const planned = planCashMovements({ ...base, movements, now: day("2029-02-01") });
    expect(planned.map((entry) => entry.sourceId)).toEqual(["p1", "inv-1:limite"]);
    expect(planned[1].movement).toEqual({ date: "31-12-2028", amount: "100.00", method: "03" });
  });

  it("rectificativa (importe negativo): entera en su fecha, por «otros medios»", () => {
    const planned = planCashMovements({ ...base, totalCents: -2_420, movements: [] });
    expect(planned).toEqual([{ sourceId: "inv-1:propio", date: base.operationDate, movement: { date: "10-03-2027", amount: "-24.20", method: "04" } }]);
  });

  it("recibidas: ningún pago se declara antes de la fecha de registro de la factura", () => {
    const planned = planCashMovements({ ...base, notBefore: day("2027-03-20"), movements: [{ id: "p1", date: day("2027-03-01"), amountCents: 12_100, method: "01" }] });
    expect(planned[0].movement.date).toBe("20-03-2027");
  });

  it("factura a cero: nada que declarar", () => {
    expect(planCashMovements({ ...base, totalCents: 0, movements: [{ id: "p1", date: day("2027-04-01"), amountCents: 100, method: "01" }] })).toEqual([]);
  });
});

describe("corrección y anulación de un cobro ya suministrado", () => {
  const declared = [{ date: "01-04-2027", amount: "100.00", method: "01" as const, account: "ES91" }];

  it("se anula con el mismo movimiento en negativo (no hay A1 ni baja en estos libros)", () => {
    expect(reverseCashMovement(declared[0])).toEqual({ date: "01-04-2027", amount: "-100.00", method: "01", account: "ES91" });
    expect(cashMovementsToSend(declared, [])).toEqual([{ ...declared[0], amount: "-100.00" }]);
  });

  it("si cambia: anulación de lo declarado seguida de lo nuevo; si no cambia, nada", () => {
    const target = [{ date: "02-04-2027", amount: "100.00", method: "01" as const, account: "ES91" }];
    expect(cashMovementsToSend(declared, target)).toEqual([{ ...declared[0], amount: "-100.00" }, target[0]]);
    expect(cashMovementsToSend(declared, declared)).toEqual([]);
    expect(sameCashMovements(declared, [{ ...declared[0], account: null }])).toBe(false);
  });

  it("periodo del cobro en la zona horaria de la empresa", () => {
    expect(cashPeriodOf(new Date("2027-03-31T23:30:00Z"), TZ)).toEqual({ year: "2027", period: "04" });
  });
});
