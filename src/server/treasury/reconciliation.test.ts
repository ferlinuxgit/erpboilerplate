import { describe, expect, it } from "vitest";

import { parseBankCsv } from "@/lib/bank-csv";

describe("bank CSV parser", () => {
  it("parses semicolon-separated bank rows with decimal comma", () => {
    const rows = parseBankCsv("fecha;importe;descripcion\n2026-07-18;1250,50;Cobro F-1042\n2026-07-19;-80.25;Comisión bancaria");
    expect(rows).toEqual([
      { postedAt: new Date("2026-07-18"), amount: 1250.5, description: "Cobro F-1042" },
      { postedAt: new Date("2026-07-19"), amount: -80.25, description: "Comisión bancaria" },
    ]);
  });

  it("ignores malformed rows without losing valid movements", () => {
    const rows = parseBankCsv("fecha;importe;descripcion\nfecha-invalida;20;Error\n2026-07-18;no-numero;Error\n2026-07-20;45;Abono");
    expect(rows).toEqual([{ postedAt: new Date("2026-07-20"), amount: 45, description: "Abono" }]);
  });
});
