import { describe, expect, it } from "vitest";

import { describeDaysUntil, formatCount, pluralize } from "@/lib/pluralize";

describe("pluralize", () => {
  it("usa el singular solo para 1 y -1", () => {
    expect(pluralize(1, "día")).toBe("día");
    expect(pluralize(-1, "día")).toBe("día");
    expect(pluralize(0, "día")).toBe("días");
    expect(pluralize(2, "modelo")).toBe("modelos");
  });

  it("forma plurales regulares y acepta irregulares", () => {
    expect(pluralize(3, "asiento")).toBe("asientos");
    expect(pluralize(3, "mes")).toBe("meses");
    expect(pluralize(3, "vez")).toBe("veces");
    expect(pluralize(3, "declaración", "declaraciones")).toBe("declaraciones");
  });

  it("formatea el número en es-ES", () => {
    expect(formatCount(1, "factura")).toBe("1 factura");
    expect(formatCount(1200, "factura")).toBe("1200 facturas".replace("1200", new Intl.NumberFormat("es-ES").format(1200)));
  });

  it("describe plazos sin 'hace 1 días'", () => {
    expect(describeDaysUntil(0)).toBe("Vence hoy");
    expect(describeDaysUntil(1)).toBe("Queda 1 día");
    expect(describeDaysUntil(5)).toBe("Quedan 5 días");
    expect(describeDaysUntil(-1)).toBe("Venció ayer");
    expect(describeDaysUntil(-3)).toBe("Venció hace 3 días");
  });
});
