import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  ensureUserTenant: vi.fn(),
  can: vi.fn(),
  createBatch: vi.fn(),
  getBatch: vi.fn(),
  assessDuplicate: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant: mocks.ensureUserTenant }));
vi.mock("@/lib/rbac", () => ({ can: mocks.can }));
vi.mock("@/server/ocr/expense-ocr", () => ({
  createExpenseOcrBatch: mocks.createBatch,
  getExpenseOcrBatch: mocks.getBatch,
}));
vi.mock("@/server/supplier-invoices/service", () => ({ assessExpenseDuplicate: mocks.assessDuplicate }));

describe("expense ingestion batch routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSession.mockResolvedValue({ user: { id: "user-1", name: "User" } });
    mocks.ensureUserTenant.mockResolvedValue({ tenant: { id: "tenant-1" }, company: { id: "company-1" }, membership: { role: "OWNER" } });
    mocks.can.mockReturnValue(true);
    mocks.createBatch.mockResolvedValue({ id: "batch-1", expectedFiles: 3 });
    mocks.assessDuplicate.mockResolvedValue({ level: "none", matches: [] });
  });

  it("creates a bounded batch for the active company", async () => {
    const { POST } = await import("@/app/api/expenses/ocr/batches/route");
    const response = await POST(new Request("https://erp.test/api/expenses/ocr/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedFiles: 3 }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.createBatch).toHaveBeenCalledWith({ tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", expectedFiles: 3 });
  });

  it("enriches every completed file with a database-backed duplicate assessment", async () => {
    mocks.getBatch.mockResolvedValue({
      id: "batch-1",
      jobs: [{ id: "job-1", documentSha256: "abc", extracted: { supplierTaxId: "B12345674", supplierCountryCode: "ES", supplierDocumentNumber: "F-1", issueDate: "2026-07-21T12:00:00.000Z", totalAmount: 121, lines: [], confidence: "high", warnings: [] } }],
    });
    const { GET } = await import("@/app/api/expenses/ocr/batches/[id]/route");
    const response = await GET(new Request("https://erp.test"), { params: Promise.resolve({ id: "batch-1" }) });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.assessDuplicate).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-1", documentSha256: "abc", supplierDocumentNumber: "F-1" }));
    expect(payload.jobs[0].duplicateAssessment.level).toBe("none");
  });
});
