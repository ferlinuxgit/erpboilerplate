import { describe, expect, it } from "vitest";

import { sealSecret, openSecret } from "@/lib/secret-box";
import { invoiceContentType, isAllowedSender, mailInboxErrorMessage, parseAllowedSenders, selectInvoiceAttachments } from "@/server/ocr/mail-inbox-model";

describe("mail inbox senders", () => {
  it("parses addresses and domains, deduplicated and lower-cased", () => {
    expect(parseAllowedSenders("Yo@Mi.es, @Proveedor.com\nasesoria.es; yo@mi.es")).toEqual(["yo@mi.es", "@proveedor.com", "@asesoria.es"]);
  });

  it("accepts only listed addresses or domains and rejects everything when the list is empty", () => {
    const allowed = parseAllowedSenders("yo@mi.es, @proveedor.com");
    expect(isAllowedSender("YO@mi.es", allowed)).toBe(true);
    expect(isAllowedSender("facturas@proveedor.com", allowed)).toBe(true);
    expect(isAllowedSender("otro@mi.es", allowed)).toBe(false);
    expect(isAllowedSender("x@proveedor.com.evil.io", allowed)).toBe(false);
    expect(isAllowedSender("yo@mi.es", [])).toBe(false);
    expect(isAllowedSender(null, allowed)).toBe(false);
  });
});

describe("mail inbox attachments", () => {
  const big = Buffer.alloc(20 * 1024, 1);

  it("detects the type by MIME or, when generic, by extension", () => {
    expect(invoiceContentType({ filename: "f.pdf", contentType: "application/octet-stream" })).toBe("application/pdf");
    expect(invoiceContentType({ filename: "ticket", contentType: "image/jpg" })).toBe("image/jpeg");
    expect(invoiceContentType({ filename: "datos.xlsx", contentType: "application/vnd.ms-excel" })).toBeNull();
  });

  it("keeps PDFs and real images, skipping logos, other files and oversized ones", () => {
    const result = selectInvoiceAttachments([
      { filename: "factura.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4") },
      { filename: "ticket.jpg", contentType: "image/jpeg", content: big },
      { filename: "logo.png", contentType: "image/png", content: Buffer.alloc(2_000) },
      { filename: "hoja.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: big },
      { filename: "enorme.pdf", contentType: "application/pdf", size: 13 * 1024 * 1024, content: Buffer.alloc(10) },
    ]);
    expect(result.accepted.map((attachment) => attachment.fileName)).toEqual(["factura.pdf", "ticket.jpg"]);
    expect(result.skipped.map((attachment) => attachment.fileName)).toEqual(["logo.png", "hoja.xlsx", "enorme.pdf"]);
  });

  it("takes at most 10 documents per email", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ filename: `f${index}.pdf`, contentType: "application/pdf", content: Buffer.from("%PDF") }));
    const result = selectInvoiceAttachments(many);
    expect(result.accepted).toHaveLength(10);
    expect(result.skipped).toHaveLength(2);
  });
});

describe("secret box", () => {
  it("round-trips and fails with another key or purpose", () => {
    const sealed = sealSecret("contraseña-imap", "mail-inbox", "app-secret-32-characters-minimum!!");
    expect(sealed).not.toContain("contraseña");
    expect(openSecret(sealed, "mail-inbox", "app-secret-32-characters-minimum!!")).toBe("contraseña-imap");
    expect(() => openSecret(sealed, "mail-inbox", "otro-secreto")).toThrow();
    expect(() => openSecret(sealed, "bank", "app-secret-32-characters-minimum!!")).toThrow();
  });
});

describe("mail inbox error messages", () => {
  it("explains network failures before credentials, even for hosts ending in .invalid", () => {
    expect(mailInboxErrorMessage(Object.assign(new Error("getaddrinfo ENOTFOUND imap.no-existe.invalid"), { code: "ENOTFOUND" }))).toMatch(/No se encuentra el servidor IMAP/);
    expect(mailInboxErrorMessage(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toMatch(/No se pudo conectar/);
    expect(mailInboxErrorMessage(Object.assign(new Error("Command failed"), { authenticationFailed: true }))).toMatch(/usuario o la contraseña/);
  });
});
