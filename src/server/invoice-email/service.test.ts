import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  function chain(): unknown {
    let resolved: unknown[] | undefined;
    const proxy: unknown = new Proxy(() => undefined, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            if (resolved === undefined) resolved = selectResults.shift() ?? [];
            return Promise.resolve(resolved).then(resolve, reject);
          };
        }
        return () => proxy;
      },
    });
    return proxy;
  }
  return {
    selectResults,
    db: { select: vi.fn(() => chain()), insert: vi.fn(() => chain()) },
    getInvoiceBalance: vi.fn(),
    recordAudit: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/invoices/service", () => ({ getInvoiceBalance: mocks.getInvoiceBalance }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { HttpError } from "@/lib/http";
import { deliverInvoiceEmail, requireMailTransport, sendInvoiceEmail, type InvoiceEmailContext } from "@/server/invoice-email/service";
import type { MailMessage, MailTransport } from "@/server/invoice-email/transport";

const actor = { tenantId: "t-1", companyId: "c-1", actorUserId: "u-1", trigger: "MANUAL" as const };

const context: InvoiceEmailContext = {
  invoiceId: "inv-1",
  number: "F2026-0001",
  invoiceType: "INVOICE",
  lifecycle: "ISSUED",
  customerId: "cus-1",
  customerName: "Cliente SL",
  customerEmail: "facturas@cliente.es",
  companyName: "Mi Empresa",
  companyEmail: "hola@miempresa.es",
  outstandingCents: 12100,
  dueDate: "2026-09-01",
  daysOverdue: 24,
  values: { numero: "F2026-0001", cliente: "Cliente SL", total: "121,00 €", pendiente: "121,00 €", vencimiento: "1 sept 2026", dias_vencida: "24", empresa: "Mi Empresa" },
};

function fakeTransport(result: Promise<{ messageId: string | null }>) {
  const sent: MailMessage[] = [];
  const transport: MailTransport = {
    send: vi.fn(async (message: MailMessage) => {
      sent.push(message);
      return result;
    }),
  };
  return { transport, sent };
}

const pdf = { filename: "invoice-F2026-0001.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" };

beforeEach(() => {
  mocks.selectResults.length = 0;
  vi.clearAllMocks();
});

describe("deliverInvoiceEmail", () => {
  it("envía con el PDF adjunto, responde al email de la empresa y registra el envío", async () => {
    const { sent, transport } = fakeTransport(Promise.resolve({ messageId: "<abc@smtp>" }));
    const writeLog = vi.fn(async () => ({ id: "log-1" }));
    const result = await deliverInvoiceEmail(
      { actor, context, kind: "INVOICE", reminderLevel: null, to: ["facturas@cliente.es"], cc: ["conta@cliente.es"], bcc: ["yo@miempresa.es"], subject: "Factura {numero}", body: "Hola {cliente}" },
      { transport, renderPdf: async () => pdf, writeLog, audit: mocks.recordAudit },
    );

    expect(result).toEqual({ logId: "log-1", status: "SENT", messageId: "<abc@smtp>", error: null });
    expect(sent[0]).toMatchObject({ to: ["facturas@cliente.es"], cc: ["conta@cliente.es"], bcc: ["yo@miempresa.es"], replyTo: "hola@miempresa.es", subject: "Factura F2026-0001", text: "Hola Cliente SL" });
    expect(sent[0]?.attachments?.[0]?.filename).toBe("invoice-F2026-0001.pdf");
    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c-1", invoiceId: "inv-1", status: "SENT", messageId: "<abc@smtp>", toEmails: "facturas@cliente.es", ccEmails: "conta@cliente.es", userId: "u-1", kind: "INVOICE", reminderLevel: null }));
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.email", entityName: "invoice", entityId: "inv-1" }));
  });

  it("si el SMTP rechaza el envío lo registra como fallido sin lanzar", async () => {
    const { transport } = fakeTransport(Promise.reject(new Error("550 mailbox unavailable")));
    const writeLog = vi.fn(async () => ({ id: "log-2" }));
    const result = await deliverInvoiceEmail(
      { actor: { ...actor, actorUserId: null, trigger: "AUTOMATIC" }, context, kind: "REMINDER", reminderLevel: 2, to: ["facturas@cliente.es"], cc: [], bcc: [], subject: "Aviso", body: "Pendiente {pendiente}" },
      { transport, renderPdf: async () => pdf, writeLog, audit: mocks.recordAudit },
    );
    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("550");
    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", kind: "REMINDER", reminderLevel: 2, trigger: "AUTOMATIC", userId: null }));
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.remind" }));
  });
});

describe("sendInvoiceEmail", () => {
  it("sin SMTP configurado da un error claro (409)", () => {
    expect(() => requireMailTransport(null)).toThrow(HttpError);
    expect(() => requireMailTransport(null)).toThrow(/Configura el correo en Configuración/);
  });

  function queueInvoice(patch: Record<string, unknown> = {}) {
    mocks.selectResults.push([{
      id: "inv-1",
      number: "F2026-0001",
      status: "SENT",
      issuedAt: new Date("2026-08-01T10:00:00Z"),
      invoiceType: "INVOICE",
      totalAmount: "121.00",
      dueDate: new Date("2026-09-01T00:00:00Z"),
      customerId: "cus-1",
      customerName: "Cliente SL",
      customerEmail: "contacto@cliente.es",
      customerInvoiceEmail: "facturas@cliente.es",
      companyName: "Mi Empresa",
      companyEmail: null,
      timezone: "Europe/Madrid",
      currency: "EUR",
      ...patch,
    }]);
    // Ajustes de plantillas: sin fila → plantillas por defecto.
    mocks.selectResults.push([]);
  }

  it("usa el email de facturación del cliente y la plantilla por defecto", async () => {
    mocks.getInvoiceBalance.mockResolvedValue({ totalCents: 12100, creditedCents: 0, paidCents: 0, outstandingCents: 12100, paymentStatus: "PENDING" });
    queueInvoice();
    const { sent, transport } = fakeTransport(Promise.resolve({ messageId: "m-1" }));
    const writeLog = vi.fn(async () => ({ id: "log-3" }));
    const result = await sendInvoiceEmail(actor, { invoiceId: "inv-1", kind: "INVOICE" }, { transport, deps: { renderPdf: async () => pdf, writeLog } });
    expect(result.status).toBe("SENT");
    expect(result.to).toEqual(["facturas@cliente.es"]);
    expect(sent[0]?.subject).toBe("Factura F2026-0001 de Mi Empresa");
    expect(sent[0]?.text).toContain("121,00");
  });

  it("no envía borradores", async () => {
    mocks.getInvoiceBalance.mockResolvedValue({ totalCents: 12100, creditedCents: 0, paidCents: 0, outstandingCents: 12100, paymentStatus: "PENDING" });
    queueInvoice({ status: "DRAFT", number: "BORRADOR-1234ABCD", issuedAt: null });
    const { transport } = fakeTransport(Promise.resolve({ messageId: "m-1" }));
    await expect(sendInvoiceEmail(actor, { invoiceId: "inv-1", kind: "INVOICE" }, { transport })).rejects.toThrow(/Solo se pueden enviar facturas emitidas/);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("no reclama facturas ya cobradas y valida destinatarios", async () => {
    mocks.getInvoiceBalance.mockResolvedValue({ totalCents: 12100, creditedCents: 0, paidCents: 12100, outstandingCents: 0, paymentStatus: "PAID" });
    queueInvoice();
    const { transport } = fakeTransport(Promise.resolve({ messageId: "m-1" }));
    await expect(sendInvoiceEmail(actor, { invoiceId: "inv-1", kind: "REMINDER", reminderLevel: 1 }, { transport })).rejects.toThrow(/ya está cobrada/);

    mocks.getInvoiceBalance.mockResolvedValue({ totalCents: 12100, creditedCents: 0, paidCents: 0, outstandingCents: 12100, paymentStatus: "PENDING" });
    mocks.selectResults.length = 0;
    queueInvoice();
    await expect(sendInvoiceEmail(actor, { invoiceId: "inv-1", kind: "INVOICE", to: "no-es-un-email" }, { transport })).rejects.toThrow(/Revisa esta dirección/);
    expect(transport.send).not.toHaveBeenCalled();
  });
});
