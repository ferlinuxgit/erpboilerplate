import { describe, expect, it } from "vitest";

import { checkIban, formatIban, isValidBic, isValidIban, mod97, normalizeIban } from "@/lib/bank-import/iban";

describe("IBAN (mod 97)", () => {
  it("accepts valid Spanish and foreign IBANs written with spaces or lowercase", () => {
    expect(isValidIban("ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(isValidIban("es9121000418450200051332")).toBe(true);
    expect(isValidIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("IBAN FR14 2004 1010 0505 0001 3M02 606")).toBe(true);
  });

  it("rejects wrong check digits, wrong length and garbage with a plain-Spanish reason", () => {
    const typo = checkIban("ES91 2100 0418 4502 0005 1333");
    expect(typo.valid).toBe(false);
    expect(!typo.valid && typo.reason).toMatch(/dígitos de control/);
    const short = checkIban("ES91 2100 0418 4502 0005 133");
    expect(!short.valid && short.reason).toMatch(/24 caracteres/);
    expect(isValidIban("")).toBe(false);
    expect(isValidIban("1234")).toBe(false);
    // IBAN ficticio que usan otros e2e: dígitos de control incorrectos.
    expect(isValidIban("ES12 3456 7890 1234 5678 9012")).toBe(false);
  });

  it("computes mod 97 of long numbers in chunks", () => {
    expect(mod97("3214282912345698765432161182")).toBe(1);
    expect(mod97("97")).toBe(0);
  });

  it("normalises and formats in groups of four", () => {
    expect(normalizeIban(" es91-2100 0418 ")).toBe("ES9121000418");
    expect(formatIban("ES9121000418450200051332")).toBe("ES91 2100 0418 4502 0005 1332");
  });

  it("validates BIC of 8 or 11 characters", () => {
    expect(isValidBic("CAIXESBBXXX")).toBe(true);
    expect(isValidBic("caixesbb")).toBe(true);
    expect(isValidBic("CAIXES")).toBe(false);
    expect(isValidBic("CAIXESBBXX")).toBe(false);
  });
});
