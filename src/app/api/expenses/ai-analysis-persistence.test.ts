import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  ensureUserTenant: vi.fn(),
  can: vi.fn(),
  analyze: vi.fn(),
  createJob: vi.fn(),
  getSettings: vi.fn(),
  processJob: vi.fn(),
  after: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));

vi.mock("@/lib/current-user", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant: mocks.ensureUserTenant }));
vi.mock("@/lib/rbac", () => ({ can: mocks.can }));
vi.mock("@/server/ai/expense-invoice-analysis", () => ({ analyzeExpenseInvoiceWithOpenAI: mocks.analyze, expenseAnalysisModel: () => "gpt-6-luna" }));
vi.mock("@/server/ocr/expense-ocr", () => ({ createExpenseOcrJob: mocks.createJob, processExpenseOcrJob: mocks.processJob }));
vi.mock("@/server/ocr/settings", () => ({ getExpenseOcrSettings: mocks.getSettings }));

describe("OpenAI expense analysis upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSession.mockResolvedValue({ user: { id: "user-1", name: "User" } });
    mocks.ensureUserTenant.mockResolvedValue({ tenant: { id: "tenant-1" }, company: { id: "company-1" }, membership: { role: "OWNER" } });
    mocks.can.mockReturnValue(true);
    mocks.createJob.mockResolvedValue({ id: "ocr-ai-1", status: "PENDING", fileName: "factura.pdf", fileUrl: "/api/expenses/ocr/ocr-ai-1/file", contentType: "application/pdf", sizeBytes: 12 });
    mocks.analyze.mockResolvedValue({ draft: { lines: [], confidence: "high", warnings: [] }, analysis: { invoice_number: "F-1" }, model: "gpt-5" });
    mocks.getSettings.mockResolvedValue({ externalAiEnabled: true, externalAiConfigured: true });
  });

  it("never sends the document to OpenAI when the company disabled external analysis", async () => {
    mocks.getSettings.mockResolvedValueOnce({ externalAiEnabled: false, externalAiConfigured: true });
    const formData = new FormData();
    formData.set("file", new File(["%PDF-test"], "factura.pdf", { type: "application/pdf" }));
    const { POST } = await import("@/app/api/expenses/ai-analysis/route");
    const response = await POST(new Request("https://erp.test/api/expenses/ai-analysis", { method: "POST", body: formData }));

    expect(response.status).toBe(403);
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("stores the original, answers at once and reads it in the background", async () => {
    const formData = new FormData();
    formData.set("file", new File(["%PDF-test"], "factura.pdf", { type: "application/pdf" }));
    formData.set("batchId", "batch-1");
    const { POST } = await import("@/app/api/expenses/ai-analysis/route");
    const response = await POST(new Request("https://erp.test/api/expenses/ai-analysis", { method: "POST", body: formData }));
    const payload = await response.json();

    // La respuesta no espera a OpenAI: un reinicio del servidor ya no deja la subida a medias.
    expect(response.status).toBe(202);
    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({ fileName: "factura.pdf", extractionProvider: "openai", batchId: "batch-1" }));
    expect(mocks.createJob.mock.calls[0][0]).not.toHaveProperty("initialStatus");
    expect(payload).toMatchObject({ jobId: "ocr-ai-1", status: "PENDING", fileUrl: "/api/expenses/ocr/ocr-ai-1/file" });
    expect(mocks.processJob).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.processJob).toHaveBeenCalledWith("ocr-ai-1");
  });

  it("does not store the document when OpenAI is not configured", async () => {
    mocks.getSettings.mockResolvedValueOnce({ externalAiEnabled: true, externalAiConfigured: false });
    const formData = new FormData();
    formData.set("file", new File(["%PDF-test"], "factura.pdf", { type: "application/pdf" }));
    const { POST } = await import("@/app/api/expenses/ai-analysis/route");
    const response = await POST(new Request("https://erp.test/api/expenses/ai-analysis", { method: "POST", body: formData }));

    expect(response.status).toBe(503);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
