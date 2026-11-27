import { describe, expect, it } from "vitest";

import { einvoiceStatusProblem, statusCommunicationDeadline, summarizeEInvoiceStatus, type EInvoiceStatusEvent } from "@/server/einvoice/status";

const context = (history: EInvoiceStatusEvent[] = []) => ({ history, issueDate: "2026-11-20", today: "2026-11-27" });

describe("estados de la factura electrónica (art. 10 RD 238/2026)", () => {
  it("resume el historial: enviada → recibida → aceptada → pagada", () => {
    const history: EInvoiceStatusEvent[] = [
      { status: "SENT", effectiveDate: "2026-11-20" },
      { status: "RECEIVED", effectiveDate: "2026-11-21" },
    ];
    expect(summarizeEInvoiceStatus([]).current).toBeNull();
    expect(summarizeEInvoiceStatus(history).current).toBe("RECEIVED");
    history.push({ status: "ACCEPTED", effectiveDate: "2026-11-23" });
    expect(summarizeEInvoiceStatus(history).current).toBe("ACCEPTED");
    history.push({ status: "PAID", effectiveDate: "2026-11-26" });
    expect(summarizeEInvoiceStatus(history)).toMatchObject({ sentOn: "2026-11-20", receivedOn: "2026-11-21", paidOn: "2026-11-26", current: "PAID", commercial: { status: "ACCEPTED", date: "2026-11-23" } });
  });

  it("el rechazo exige motivo y manda sobre el resto hasta que se acepte", () => {
    expect(einvoiceStatusProblem({ status: "REJECTED", effectiveDate: "2026-11-24", reason: " " }, context())).toContain("motivo del rechazo");
    expect(einvoiceStatusProblem({ status: "REJECTED", effectiveDate: "2026-11-24", reason: "Precio distinto del pactado", rejectionCode: "99" }, context())).toContain("tipo de rechazo");
    const rejected: EInvoiceStatusEvent[] = [{ status: "REJECTED", effectiveDate: "2026-11-24", reason: "Precio distinto del pactado", rejectionCode: "01" }];
    expect(einvoiceStatusProblem(rejected[0], context())).toBeNull();
    expect(summarizeEInvoiceStatus(rejected)).toMatchObject({ current: "REJECTED", commercial: { reason: "Precio distinto del pactado", rejectionCode: "01" } });
    expect(einvoiceStatusProblem({ status: "PAID", effectiveDate: "2026-11-26" }, context(rejected))).toContain("rechazada");
    const accepted = [...rejected, { status: "ACCEPTED" as const, effectiveDate: "2026-11-25" }];
    expect(einvoiceStatusProblem({ status: "PAID", effectiveDate: "2026-11-26" }, context(accepted))).toBeNull();
    expect(summarizeEInvoiceStatus(accepted).current).toBe("ACCEPTED");
  });

  it("fechas: obligatoria, real, no futura y no anterior a la factura (salvo el pago anticipado)", () => {
    expect(einvoiceStatusProblem({ status: "ACCEPTED", effectiveDate: "" }, context())).toContain("fecha");
    expect(einvoiceStatusProblem({ status: "ACCEPTED", effectiveDate: "2026-02-30" }, context())).toContain("fecha");
    expect(einvoiceStatusProblem({ status: "ACCEPTED", effectiveDate: "2026-11-28" }, context())).toContain("futura");
    expect(einvoiceStatusProblem({ status: "ACCEPTED", effectiveDate: "2026-11-19" }, context())).toContain("anterior");
    expect(einvoiceStatusProblem({ status: "PAID", effectiveDate: "2026-11-19" }, context())).toBeNull();
  });

  it("no duplica el pago, la aceptación, el envío ni la recepción", () => {
    const history: EInvoiceStatusEvent[] = [
      { status: "SENT", effectiveDate: "2026-11-20" },
      { status: "RECEIVED", effectiveDate: "2026-11-20" },
      { status: "ACCEPTED", effectiveDate: "2026-11-21" },
      { status: "PAID", effectiveDate: "2026-11-22" },
    ];
    for (const status of ["SENT", "RECEIVED", "ACCEPTED", "PAID"] as const) {
      expect(einvoiceStatusProblem({ status, effectiveDate: "2026-11-23" }, context(history))).not.toBeNull();
    }
  });

  it("plazo de comunicación: cuatro días sin sábados ni domingos", () => {
    // Viernes 20-11-2026 → lunes 23, martes 24, miércoles 25, jueves 26.
    expect(statusCommunicationDeadline("2026-11-20")).toBe("2026-11-26");
    // Lunes 23-11-2026 → viernes 27.
    expect(statusCommunicationDeadline("2026-11-23")).toBe("2026-11-27");
    // Miércoles 25-11-2026 → jueves, viernes, lunes, martes 1-12.
    expect(statusCommunicationDeadline("2026-11-25")).toBe("2026-12-01");
    expect(statusCommunicationDeadline("no es fecha")).toBeNull();
  });
});
