import { describe, expect, it } from "vitest";

import { auditActionLabel, auditEntityLabel } from "@/lib/status-labels";

describe("audit labels", () => {
  it("maps known audit actions to Spanish labels", () => {
    expect(auditActionLabel("invoice.issue")).toBe("Factura emitida");
    expect(auditActionLabel("customer.create")).toBe("Cliente creado");
    expect(auditActionLabel("security_policy.updated")).toBe("Política de seguridad modificada");
  });

  it("falls back to a readable version of unknown codes", () => {
    expect(auditActionLabel("fooBar.bazQux")).toBe("Foo bar baz qux");
    expect(auditActionLabel("some_thing.done")).toBe("Some thing done");
  });

  it("labels entity names, including legacy snake_case aliases", () => {
    expect(auditEntityLabel("salesQuote")).toBe("Presupuesto");
    expect(auditEntityLabel("delivery_note")).toBe("Albarán");
    expect(auditEntityLabel("unknownEntity")).toBe("Unknown entity");
  });
});
