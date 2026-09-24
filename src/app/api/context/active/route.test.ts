import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireContext, listUserTenants, cookieStore, dbRows, getUserSession, acceptInvitation } = vi.hoisted(() => ({
  requireContext: vi.fn(),
  listUserTenants: vi.fn(),
  cookieStore: { set: vi.fn(), delete: vi.fn(), get: vi.fn() },
  dbRows: { current: [] as unknown[] },
  getUserSession: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/current-context", () => ({ requireContext }));
vi.mock("@/lib/current-user", () => ({ getUserSession }));
vi.mock("@/lib/tenant", () => ({ listUserTenants }));
vi.mock("@/server/team/service", () => ({ acceptInvitation }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(async () => dbRows.current),
        limit: vi.fn(async () => dbRows.current),
      };
      return chain;
    }),
  },
}));

const context = {
  tenant: { id: "tenant-a", name: "A", slug: "a" },
  company: { id: "company-a", name: "Empresa A" },
  fiscalYear: { id: "fy-a", code: "2026" },
  membership: { id: "m-a", role: "OWNER" },
  availableCompanies: [{ id: "company-a", name: "Empresa A" }],
  availableFiscalYears: [{ id: "fy-a", code: "2026" }],
  user: { id: "user-1", name: "Ana", email: "ana@example.com" },
};

function patch(body: unknown) {
  return new Request("https://erp.example.com/api/context/active", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

describe("/api/context/active", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireContext.mockResolvedValue(context);
    listUserTenants.mockResolvedValue([
      { id: "tenant-a", name: "A", role: "OWNER" },
      { id: "tenant-b", name: "B", role: "MEMBER" },
    ]);
    dbRows.current = [];
  });

  it("GET exposes the active tenant and the user's tenants while keeping the previous shape", async () => {
    const { GET } = await import("@/app/api/context/active/route");
    const response = await GET();
    const payload = await response.json();

    expect(payload.active).toEqual({ tenantId: "tenant-a", companyId: "company-a", fiscalYearId: "fy-a" });
    expect(payload.availableTenants).toHaveLength(2);
    expect(payload.user).toEqual({ name: "Ana", email: "ana@example.com", role: "OWNER" });
    expect(payload.availableFiscalYearsByCompany).toHaveProperty("company-a");
  });

  it("GET answers 401 JSON without a session", async () => {
    const { UnauthorizedError } = await import("@/lib/http");
    requireContext.mockRejectedValue(new UnauthorizedError());
    const { GET } = await import("@/app/api/context/active/route");
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("PATCH rejects a tenant the user does not belong to", async () => {
    const { PATCH } = await import("@/app/api/context/active/route");
    const response = await PATCH(patch({ tenantId: "tenant-evil" }));
    expect(response.status).toBe(404);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("PATCH switches tenant and clears the company/fiscal-year selection of the previous one", async () => {
    const { PATCH } = await import("@/app/api/context/active/route");
    const response = await PATCH(patch({ tenantId: "tenant-b" }));

    expect(response.status).toBe(200);
    expect(cookieStore.set).toHaveBeenCalledWith("active-tenant-id", "tenant-b", expect.objectContaining({ httpOnly: true }));
    expect(cookieStore.delete).toHaveBeenCalledWith("active-company-id");
    expect(cookieStore.delete).toHaveBeenCalledWith("active-fiscal-year-id");
  });

  it("PATCH still accepts the legacy {companyId, fiscalYearId} payload and validates ownership", async () => {
    const { PATCH } = await import("@/app/api/context/active/route");
    expect((await PATCH(patch({ companyId: "company-x", fiscalYearId: "fy-x" }))).status).toBe(404);

    dbRows.current = [{ fiscalYearId: "fy-a" }];
    const response = await PATCH(patch({ companyId: "company-a", fiscalYearId: "fy-a" }));
    expect(response.status).toBe(200);
    expect(cookieStore.set).toHaveBeenCalledWith("active-company-id", "company-a", expect.any(Object));
    expect(cookieStore.set).not.toHaveBeenCalledWith("active-tenant-id", expect.anything(), expect.anything());
  });

  it("accepting an invitation switches to the invited tenant", async () => {
    getUserSession.mockResolvedValue({ user: { id: "user-1", name: "Ana", email: "ana@example.com" } });
    acceptInvitation.mockResolvedValue({ tenantId: "tenant-b", membershipId: "m-b" });
    const { POST } = await import("@/app/api/invitations/[id]/accept/route");

    const response = await POST(new Request("https://erp.example.com/api/invitations/tok/accept", { method: "POST" }), { params: Promise.resolve({ id: "tok" }) });

    expect(response.status).toBe(200);
    expect(cookieStore.set).toHaveBeenCalledWith("active-tenant-id", "tenant-b", expect.any(Object));
    expect(cookieStore.delete).toHaveBeenCalledWith("active-company-id");
  });
});
