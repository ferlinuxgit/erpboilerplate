import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  ensureUserTenant: vi.fn(),
  can: vi.fn(),
  createExpenseInvoice: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant: mocks.ensureUserTenant }));
vi.mock("@/lib/rbac", () => ({ can: mocks.can }));
vi.mock("@/server/supplier-invoices/service", () => ({ createExpenseInvoice: mocks.createExpenseInvoice, listExpenseInvoices: vi.fn() }));

describe("expense OCR association", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSession.mockResolvedValue({ user: { id: "user-1", name: "User" } });
    mocks.ensureUserTenant.mockResolvedValue({ tenant: { id: "tenant-1" }, company: { id: "company-1" }, fiscalYear: { id: "year-1" }, membership: { role: "OWNER" } });
    mocks.can.mockReturnValue(true);
    mocks.createExpenseInvoice.mockResolvedValue({ id: "expense-1" });
  });

  it("passes the stored OCR job to the transactional expense creation service", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const response = await POST(new Request("https://erp.test/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierName: "Proveedor OCR",
        issueDate: "2026-07-20T12:00:00.000Z",
        ocrJobId: "ocr-job-1",
        lines: [{ description: "Servicio", quantity: 1, unitPrice: 100, taxRate: 21, taxDeductiblePct: 100, retentionRate: 0 }],
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createExpenseInvoice).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-1", ocrJobId: "ocr-job-1" }));
  });
});
