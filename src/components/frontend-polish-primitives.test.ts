import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function sourceFor(path: string) {
  return readFileSync(join(root, path), "utf8");
}

const coreRouteSegments = ["dashboard", "customers", "suppliers", "invoices", "sales", "purchases", "inventory", "accounting", "treasury", "settings", "fiscal", "billing", "onboarding"];

describe("frontend polish primitives", () => {
  it.each(coreRouteSegments)("%s route segment has shared loading, error, and not-found states", (segment) => {
    const base = `src/app/${segment}`;

    expect(existsSync(join(root, base, "loading.tsx")), `${segment} needs a route loading state`).toBe(true);
    expect(existsSync(join(root, base, "error.tsx")), `${segment} needs a route error state`).toBe(true);
    expect(existsSync(join(root, base, "not-found.tsx")), `${segment} needs a route not-found state`).toBe(true);

    expect(sourceFor(`${base}/loading.tsx`)).toContain("RouteLoadingState");
    expect(sourceFor(`${base}/error.tsx`)).toContain("RouteErrorState");
    expect(sourceFor(`${base}/not-found.tsx`)).toContain("RouteNotFoundState");
  });

  it("replaces native destructive prompts with an accessible dialog primitive", () => {
    const deleteButton = sourceFor("src/components/delete-button.tsx");
    const dialog = sourceFor("src/components/ui/destructive-action-dialog.tsx");

    expect(deleteButton).not.toMatch(/window\.(confirm|alert)\(/);
    expect(deleteButton).toContain("DestructiveActionDialog");
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain("onKeyDown");
    expect(dialog).toMatch(/role="alert"/);
    expect(deleteButton).toContain("toast.success");
    expect(deleteButton).toContain("toast.error");
  });

  it("passes contextual destructive action copy from customer and invoice rows", () => {
    const customerRows = sourceFor("src/components/customers/customers-table.tsx");
    const customerActions = sourceFor("src/components/customers/customer-row-actions.tsx");
    const invoiceRows = sourceFor("src/components/invoices/invoices-list.tsx");
    const invoiceActions = sourceFor("src/components/invoices/invoice-row-actions.tsx");

    expect(customerActions).toContain("name");
    expect(customerActions).toContain("title=");
    expect(customerActions).toContain("successMessage=");
    expect(customerRows).toContain("name={customer.name}");
    expect(invoiceActions).toContain("number");
    expect(invoiceActions).toContain("title=");
    expect(invoiceActions).toContain("successMessage=");
    expect(invoiceRows).toContain("number={invoice.number}");
  });

  it("migrates customers and invoices to the shared resource list primitive", () => {
    const resourceList = sourceFor("src/components/ui/resource-list.tsx");
    const customersTable = sourceFor("src/components/customers/customers-table.tsx");
    const invoicesList = sourceFor("src/components/invoices/invoices-list.tsx");
    const invoicesPage = sourceFor("src/app/invoices/page.tsx");

    expect(resourceList).toContain("searchQuery");
    expect(resourceList).toContain("pageSize");
    expect(resourceList).toContain("data-testid=\"resource-list-mobile\"");
    expect(customersTable).toContain("ResourceList");
    expect(invoicesList).toContain("ResourceList");
    expect(invoicesPage).toContain("InvoicesList");
  });

  it("uses shared accessible field wrappers on high-visibility customer and invoice forms", () => {
    expect(sourceFor("src/components/ui/form.tsx")).toContain("AccessibleField");
    expect(sourceFor("src/components/create-customer-form.tsx")).toContain("AccessibleField");
    expect(sourceFor("src/components/create-invoice-form.tsx")).toContain("AccessibleField");
  });

  it("keeps the dashboard smoke surface observable for Playwright", () => {
    const dashboardPage = sourceFor("src/app/dashboard/page.tsx");

    expect(dashboardPage).toContain("buildDashboardCockpit");
    expect(dashboardPage).toContain('data-testid="dashboard-metrics"');
    expect(dashboardPage).toContain('data-testid="dashboard-primary-actions"');
    expect(dashboardPage).toContain('data-testid="dashboard-empty-states"');
    expect(dashboardPage).toContain('data-testid="dashboard-guided-demo"');
    expect(dashboardPage).toContain("cockpit.guidedDemoSteps.map");
    expect(dashboardPage).toContain("inventoryItemsCount: items.length");
    expect(dashboardPage).toContain("dashboardDataError");
    expect(dashboardPage).toContain("loadDashboardData");
    expect(dashboardPage).toContain('aria-label="Alertas operativas"');
  });
});
