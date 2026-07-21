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
    expect(dialog).toContain("<Dialog");
    expect(sourceFor("src/components/ui/dialog.tsx")).toContain('role="dialog"');
    expect(sourceFor("src/components/ui/dialog.tsx")).toContain('aria-modal="true"');
    expect(sourceFor("src/components/ui/dialog.tsx")).toContain("onKeyDown");
    expect(dialog).toMatch(/role="alert"/);
    expect(deleteButton).toContain("toast.success");
    expect(deleteButton).toContain("toast.error");
  });

  it("uses independent pages for create and edit flows while preserving robust contextual dialogs", () => {
    const dialog = sourceFor("src/components/ui/dialog.tsx");
    const accountingPage = sourceFor("src/app/accounting/page.tsx");
    const treasuryPage = sourceFor("src/app/treasury/page.tsx");
    const fiscalPage = sourceFor("src/app/fiscal/page.tsx");

    expect(dialog).toContain("createPortal");
    expect(dialog).toContain('document.body.style.overflow = "hidden"');
    expect(dialog).toContain("previouslyFocused?.focus()");
    expect(dialog).toContain('event.key !== "Tab"');
    expect(dialog).toContain("aria-describedby");
    expect(accountingPage).toContain('href="/accounting/accounts/new"');
    expect(treasuryPage).toContain('href="/treasury/bank-transactions/new"');
    expect(fiscalPage).toContain('href="/fiscal/new"');
    expect(existsSync(join(root, "src/app/accounting/accounts/[id]/edit/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/app/treasury/bank-transactions/[id]/edit/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/app/fiscal/[id]/edit/page.tsx"))).toBe(true);
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

  it("provides a global command palette and independent record detail routes", () => {
    const palette = sourceFor("src/components/layout/global-command-palette.tsx");
    const appShell = sourceFor("src/components/layout/app-shell.tsx");
    const detailRoutes = [
      "src/app/customers/[id]/page.tsx",
      "src/app/purchases/[id]/page.tsx",
      "src/app/accounting/entries/[id]/page.tsx",
      "src/app/fiscal/[id]/page.tsx",
      "src/app/treasury/bank-accounts/[id]/page.tsx",
      "src/app/treasury/bank-transactions/[id]/page.tsx",
      "src/app/inventory/items/[id]/page.tsx",
      "src/app/inventory/warehouses/[id]/page.tsx",
    ];

    expect(appShell).toContain("GlobalCommandPalette");
    expect(appShell).toContain('id="main-content"');
    expect(palette).toContain('event.metaKey || event.ctrlKey');
    expect(palette).toContain('/api/search?q=');
    detailRoutes.forEach((route) => expect(existsSync(join(root, route)), `${route} must exist`).toBe(true));
  });

  it("organizes sales as independent quote, order, and delivery-note sections", () => {
    const salesPage = sourceFor("src/app/sales/page.tsx");
    const appShell = sourceFor("src/components/layout/app-shell.tsx");
    const navigationConfig = sourceFor("src/components/layout/navigation-config.ts");
    const contextNavigation = sourceFor("src/components/layout/context-navigation.tsx");
    const salesRoutes = [
      "src/app/sales/quotes/page.tsx",
      "src/app/sales/orders/page.tsx",
      "src/app/sales/delivery-notes/page.tsx",
    ];

    expect(salesPage).toContain('redirect("/sales/quotes")');
    expect(appShell).not.toContain('{ href: "/sales", label: "Ventas"');
    expect(navigationConfig).toContain('{ href: "/sales/quotes", label: "Presupuestos"');
    expect(navigationConfig).toContain('{ href: "/sales/orders", label: "Pedidos"');
    expect(navigationConfig).toContain('{ href: "/sales/delivery-notes", label: "Albaranes"');
    expect(navigationConfig).toContain('roots: ["/customers", "/sales", "/invoices"]');
    expect(contextNavigation).toContain("getContextGroup");
    salesRoutes.forEach((route) => expect(existsSync(join(root, route)), `${route} must exist`).toBe(true));
    expect(sourceFor("src/app/sales/quotes/page.tsx")).toContain('testId="sales-quotes-list"');
    expect(sourceFor("src/app/sales/orders/page.tsx")).toContain('testId="sales-orders-list"');
    expect(sourceFor("src/app/sales/delivery-notes/page.tsx")).toContain('testId="sales-delivery-notes-list"');
  });
});
