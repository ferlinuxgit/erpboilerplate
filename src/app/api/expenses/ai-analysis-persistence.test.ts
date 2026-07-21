import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  ensureUserTenant: vi.fn(),
  can: vi.fn(),
  analyze: vi.fn(),
  createJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant: mocks.ensureUserTenant }));
vi.mock("@/lib/rbac", () => ({ can: mocks.can }));
vi.mock("@/server/ai/expense-invoice-analysis", () => ({ analyzeExpenseInvoiceWithOpenAI: mocks.analyze }));
vi.mock("@/server/ocr/expense-ocr", () => ({ createExpenseOcrJob: mocks.createJob, completeExpenseOcrJob: mocks.completeJob, failExpenseOcrJob: mocks.failJob }));

describe("OpenAI expense analysis persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSession.mockResolvedValue({ user: { id: "user-1", name: "User" } });
    mocks.ensureUserTenant.mockResolvedValue({ tenant: { id: "tenant-1" }, company: { id: "company-1" }, membership: { role: "OWNER" } });
    mocks.can.mockReturnValue(true);
    mocks.createJob.mockResolvedValue({ id: "ocr-ai-1", fileName: "factura.pdf", fileUrl: "/api/expenses/ocr/ocr-ai-1/file", contentType: "application/pdf", sizeBytes: 12 });
    mocks.analyze.mockResolvedValue({ draft: { lines: [], confidence: "high", warnings: [] }, analysis: { invoice_number: "F-1" }, model: "gpt-5" });
    mocks.completeJob.mockResolvedValue({ id: "ocr-ai-1", status: "DONE" });
  });

  it("stores the original before analysis and returns its job identifier", async () => {
    const formData = new FormData();
    formData.set("file", new File(["%PDF-test"], "factura.pdf", { type: "application/pdf" }));
    const { POST } = await import("@/app/api/expenses/ai-analysis/route");
    const response = await POST(new Request("https://erp.test/api/expenses/ai-analysis", { method: "POST", body: formData }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({ initialStatus: "PROCESSING", fileName: "factura.pdf" }));
    expect(mocks.completeJob).toHaveBeenCalledWith(
      "ocr-ai-1",
      expect.objectContaining({ confidence: "high" }),
      expect.any(String),
      { provider: "openai", model: "gpt-5" },
    );
    expect(payload).toMatchObject({ jobId: "ocr-ai-1", fileUrl: "/api/expenses/ocr/ocr-ai-1/file" });
  });

  it("keeps the stored original available when analysis fails", async () => {
    mocks.analyze.mockRejectedValueOnce(new Error("No se pudo leer el documento."));
    const formData = new FormData();
    formData.set("file", new File(["%PDF-test"], "factura-error.pdf", { type: "application/pdf" }));
    const { POST } = await import("@/app/api/expenses/ai-analysis/route");
    const response = await POST(new Request("https://erp.test/api/expenses/ai-analysis", { method: "POST", body: formData }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(mocks.failJob).toHaveBeenCalledWith("ocr-ai-1", expect.any(Error));
    expect(payload).toMatchObject({
      jobId: "ocr-ai-1",
      fileName: "factura.pdf",
      fileUrl: "/api/expenses/ocr/ocr-ai-1/file",
    });
  });
});
