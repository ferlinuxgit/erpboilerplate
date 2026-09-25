import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMAIL_TEMPLATES,
  isValidEmail,
  parseEmailList,
  plainTextToHtml,
  renderEmailTemplate,
  singleLineSubject,
  templateKeyFor,
} from "@/server/invoice-email/templates";

const values = {
  numero: "F2026-0042",
  cliente: "Talleres Pérez SL",
  total: "1.210,00 €",
  pendiente: "610,00 €",
  vencimiento: "15 oct 2026",
  dias_vencida: "12",
  empresa: "Estudio Ruiz",
};

describe("plantillas de email", () => {
  it("rellena las variables de la plantilla de envío", () => {
    expect(renderEmailTemplate(DEFAULT_EMAIL_TEMPLATES.invoice.subject, values)).toBe("Factura F2026-0042 de Estudio Ruiz");
    expect(renderEmailTemplate(DEFAULT_EMAIL_TEMPLATES.invoice.body, values)).toContain("factura F2026-0042 por importe de 1.210,00 €, con vencimiento el 15 oct 2026");
  });

  it("deja visibles las variables desconocidas", () => {
    expect(renderEmailTemplate("Hola {cliente}, {firma}", values)).toBe("Hola Talleres Pérez SL, {firma}");
  });

  it("elige la plantilla según el tipo y el nivel", () => {
    expect(templateKeyFor("INVOICE")).toBe("invoice");
    expect(templateKeyFor("REMINDER", 1)).toBe("reminder1");
    expect(templateKeyFor("REMINDER", 2)).toBe("reminder2");
    expect(templateKeyFor("REMINDER", 3)).toBe("reminder3");
    expect(renderEmailTemplate(DEFAULT_EMAIL_TEMPLATES.reminder2.subject, values)).toBe("Segundo aviso: factura F2026-0042 vencida hace 12 días");
  });

  it("el asunto nunca contiene saltos de línea (inyección de cabeceras)", () => {
    expect(singleLineSubject("Factura\r\nBcc: otro@x.es")).toBe("Factura Bcc: otro@x.es");
  });

  it("convierte el texto a HTML escapado por párrafos", () => {
    expect(plainTextToHtml("Hola <b>\nlínea\n\nAdiós & gracias")).toBe("<p>Hola &lt;b&gt;<br>línea</p><p>Adiós &amp; gracias</p>");
  });

  it("valida y normaliza listas de emails", () => {
    expect(parseEmailList("a@x.es, b@y.es; A@x.es  c@z.com")).toEqual(["a@x.es", "b@y.es", "c@z.com"]);
    expect(isValidEmail("facturas@empresa.es")).toBe(true);
    expect(isValidEmail("sin-arroba")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});
