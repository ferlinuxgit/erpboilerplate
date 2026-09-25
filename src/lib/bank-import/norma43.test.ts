import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { looksLikeNorma43, matchesSpanishIban, parseNorma43, parseNorma43Date } from "@/lib/bank-import/norma43";

const fixture = readFileSync(join(__dirname, "__fixtures__", "extracto-norma43.txt"), "utf8");

describe("Norma 43 (AEB 43) parser", () => {
  it("detects the format", () => {
    expect(looksLikeNorma43(fixture)).toBe(true);
    expect(looksLikeNorma43("fecha;importe;concepto\n2026-09-01;10;x")).toBe(false);
  });

  it("reads the account header, movements, signs, concepts and running balances", () => {
    const result = parseNorma43(fixture);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.accounts).toHaveLength(1);
    const [account] = result.accounts;
    expect(account).toMatchObject({
      bankCode: "2100",
      branchCode: "0418",
      accountNumber: "0200051332",
      currency: "EUR",
      holderName: "EMPRESA DEMO SL",
      initialBalance: 15000,
      finalBalance: 15358.2,
    });
    expect(account.startDate).toEqual(new Date(Date.UTC(2026, 8, 1)));
    expect(account.movements.map((movement) => [movement.postedAt.toISOString().slice(0, 10), movement.amount, movement.balanceAfter])).toEqual([
      ["2026-09-02", -12.5, 14987.5],
      ["2026-09-03", 1210, 16197.5],
      ["2026-09-05", -294, 15903.5],
      ["2026-09-10", -45.3, 15858.2],
      ["2026-09-15", -500, 15358.2],
    ]);
    // Conceptos de los registros 23 (unidos) y, sin ellos, el concepto común + referencias.
    expect(account.movements[0].description).toBe("COMISION MANTENIMIENTO CUENTA");
    expect(account.movements[1].description).toBe("TRANSF DE CLIENTE EJEMPLO SA PAGO FRA F-2026-0042");
    expect(account.movements[1].reference).toBe("F-2026-0042");
    expect(account.movements[2].description).toBe("RECIBO TGSS REGIMEN ESPECIAL TRABAJADORES AUTONOMOS");
    expect(account.movements[2].reference).toBe("TGSS202609");
    expect(account.movements[3].description).toBe("Tarjeta de crédito o débito · REPSOL MADRID");
    expect(account.movements[0].line).toBe(2);
  });

  it("warns when the declared final balance does not match the movements", () => {
    const tampered = fixture.replace("00000001535820", "00000001535830");
    expect(parseNorma43(tampered).warnings[0]).toMatch(/saldo final/);
  });

  it("explains invalid records instead of dropping them silently", () => {
    const broken = fixture.replace("22    0418260910260910", "22    0418261310260910");
    const result = parseNorma43(broken);
    expect(result.skipped).toEqual([{ line: 8, reason: "Fecha de operación no válida." }]);
    expect(result.accounts[0].movements).toHaveLength(4);
  });

  it("parses AAMMDD dates and matches the account with its Spanish IBAN", () => {
    expect(parseNorma43Date("260229")).toBeNull();
    expect(parseNorma43Date("280229")).toEqual(new Date(Date.UTC(2028, 1, 29)));
    const [account] = parseNorma43(fixture).accounts;
    expect(matchesSpanishIban(account, "ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(matchesSpanishIban(account, "ES76 2077 0024 0031 0257 5766")).toBe(false);
  });
});
