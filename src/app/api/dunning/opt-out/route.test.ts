import { beforeEach, describe, expect, it, vi } from "vitest";

/** Casilla «No enviar recordatorios de cobro» (ficha del cliente, edición y Cobros pendientes). */

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  setCustomerDunningOptOut: vi.fn(),
}));

vi.mock("@/lib/current-context", () => ({ requireContext: mocks.requireContext }));
vi.mock("@/server/dunning/service", () => ({ setCustomerDunningOptOut: mocks.setCustomerDunningOptOut }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { ForbiddenError, HttpError } from "@/lib/http";
import { POST } from "@/app/api/dunning/opt-out/route";

const ctx = { tenant: { id: "t-1" }, company: { id: "c-1" }, user: { id: "u-1" } };

function request(body: unknown) {
  return new Request("http://localhost/api/dunning/opt-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContext.mockResolvedValue(ctx);
  mocks.setCustomerDunningOptOut.mockImplementation(async (_actor: unknown, customerId: string, optOut: boolean) => ({ customerId, optOut }));
});

describe("POST /api/dunning/opt-out", () => {
  it("excluye al cliente con el contexto de la sesión (empresa y usuario del servidor)", async () => {
    const response = await POST(request({ customerId: "cus-1", optOut: true, companyId: "otra" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ customerId: "cus-1", optOut: true });
    expect(mocks.requireContext).toHaveBeenCalledWith("invoice.write");
    expect(mocks.setCustomerDunningOptOut).toHaveBeenCalledWith({ tenantId: "t-1", companyId: "c-1", actorUserId: "u-1" }, "cus-1", true);
  });

  it("vuelve a incluirlo al desmarcar la casilla", async () => {
    await POST(request({ customerId: "cus-1", optOut: false }));
    expect(mocks.setCustomerDunningOptOut).toHaveBeenCalledWith(expect.anything(), "cus-1", false);
  });

  it("valida el cuerpo", async () => {
    const response = await POST(request({ customerId: "", optOut: "sí" }));
    expect(response.status).toBe(400);
    expect(mocks.setCustomerDunningOptOut).not.toHaveBeenCalled();
  });

  it("sin permiso de facturas responde 403", async () => {
    mocks.requireContext.mockRejectedValue(new ForbiddenError());
    const response = await POST(request({ customerId: "cus-1", optOut: true }));
    expect(response.status).toBe(403);
  });

  it("cliente de otra empresa: 404 del servicio", async () => {
    mocks.setCustomerDunningOptOut.mockRejectedValue(new HttpError(404, "Cliente no encontrado."));
    const response = await POST(request({ customerId: "ajeno", optOut: true }));
    expect(response.status).toBe(404);
  });
});
