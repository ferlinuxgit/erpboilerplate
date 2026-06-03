import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const apiRouteFiles = [
  "src/app/api/accounts/[id]/route.ts",
  "src/app/api/accounts/route.ts",
  "src/app/api/accounting/masters/route.ts",
  "src/app/api/api-keys/route.ts",
  "src/app/api/api-keys/[id]/route.ts",
  "src/app/api/auth/login/route.ts",
  "src/app/api/auth/register/route.ts",
  "src/app/api/bank-accounts/[id]/route.ts",
  "src/app/api/bank-accounts/route.ts",
  "src/app/api/bank-transactions/[id]/route.ts",
  "src/app/api/bank-transactions/route.ts",
  "src/app/api/billing/checkout/route.ts",
  "src/app/api/company/defaults/route.ts",
  "src/app/api/company/profile/route.ts",
  "src/app/api/company-settings/route.ts",
  "src/app/api/context/active/route.ts",
  "src/app/api/customers/[id]/route.ts",
  "src/app/api/customers/route.ts",
  "src/app/api/delivery-notes/route.ts",
  "src/app/api/document-series/route.ts",
  "src/app/api/expenses/[id]/route.ts",
  "src/app/api/expenses/ocr/[id]/file/route.ts",
  "src/app/api/expenses/ocr/[id]/route.ts",
  "src/app/api/expenses/ocr/route.ts",
  "src/app/api/expenses/route.ts",
  "src/app/api/fiscal-reports/[id]/route.ts",
  "src/app/api/fiscal-reports/route.ts",
  "src/app/api/goods-receipts/route.ts",
  "src/app/api/inventory/route.ts",
  "src/app/api/invitations/route.ts",
  "src/app/api/invoice-payments/route.ts",
  "src/app/api/invoices/[id]/route.ts",
  "src/app/api/invoices/route.ts",
  "src/app/api/item-categories/route.ts",
  "src/app/api/items/route.ts",
  "src/app/api/journal-entries/[id]/route.ts",
  "src/app/api/journal-entries/route.ts",
  "src/app/api/onboarding/seed/route.ts",
  "src/app/api/payment-methods/route.ts",
  "src/app/api/purchases/[id]/route.ts",
  "src/app/api/purchases/route.ts",
  "src/app/api/sales-orders/route.ts",
  "src/app/api/sales-quotes/route.ts",
  "src/app/api/security-policy/route.ts",
  "src/app/api/stock-movements/route.ts",
  "src/app/api/storage/presign/route.ts",
  "src/app/api/supplier-invoices/route.ts",
  "src/app/api/supplier-payments/route.ts",
  "src/app/api/tax-retentions/route.ts",
  "src/app/api/taxes/route.ts",
  "src/app/api/treasury/import-csv/route.ts",
  "src/app/api/unit-of-measure/route.ts",
  "src/app/api/warehouses/route.ts",
];

function sourceFor(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("api JSON hardening", () => {
  it.each(apiRouteFiles)("%s does not parse JSON bodies directly", (path) => {
    expect(sourceFor(path)).not.toContain("request.json()");
  });
});
