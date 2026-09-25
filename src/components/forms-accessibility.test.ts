import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const coveredForms = [
  "src/components/create-invoice-form.tsx",
  "src/components/invoices/edit-invoice-form.tsx",
  "src/components/create-customer-form.tsx",
  "src/components/customers/edit-customer-form.tsx",
  "src/components/suppliers/create-supplier-form.tsx",
  "src/components/suppliers/edit-supplier-form.tsx",
  "src/components/invoices/register-invoice-payment-dialog.tsx",
  "src/components/sales/create-delivery-note-form.tsx",
  "src/components/purchases/receive-purchase-button.tsx",
  "src/components/purchases/register-supplier-payment-button.tsx",
  "src/components/purchases/create-supplier-invoice-from-receipt-button.tsx",
  "src/components/treasury/create-bank-transaction-form.tsx",
  "src/components/treasury/edit-bank-transaction-form.tsx",
  "src/components/fiscal/create-fiscal-report-form.tsx",
  "src/components/fiscal/edit-fiscal-report-form.tsx",
  // create/edit purchase order and sales quote/order forms are thin wrappers around these editors.
  "src/components/purchases/purchase-order-form.tsx",
  "src/components/sales/sales-document-form.tsx",
  "src/components/invoices/document-lines-editor.tsx",
  "src/components/invoices/invoice-form-controls.tsx",
  "src/components/expenses/create-expense-invoice-form.tsx",
  "src/components/accounting/edit-account-form.tsx",
  "src/components/accounting/edit-journal-entry-form.tsx",
  "src/components/accounting/journal-lines-editor.tsx",
  "src/components/fiscal/mark-fiscal-report-filed-button.tsx",
  "src/components/inventory/item-form.tsx",
  "src/components/inventory/warehouse-form.tsx",
  "src/components/inventory/inventory-operations-panel.tsx",
  "src/components/company/company-profile-form.tsx",
  "src/components/settings/masters-panel.tsx",
  "src/components/settings/payment-methods-panel.tsx",
  "src/components/onboarding/onboarding-wizard.tsx",
];

function sourceFor(path: string) {
  return readFileSync(join(root, path), "utf8");
}

type FormControl = { markup: string; index: number };

function formControls(source: string): FormControl[] {
  return Array.from(
    source.matchAll(/<(Input|select|Select|textarea|Textarea|MoneyInput|PercentInput|QuantityInput)\b[\s\S]*?(?:\/>|(?<!=)>)/g),
  ).map((match) => ({ markup: match[0], index: match.index ?? 0 }));
}

/** A control rendered as the direct child of `<AccessibleField id=…>` receives that id and its label. */
function isAccessibleFieldChild(source: string, control: FormControl) {
  const before = source.slice(Math.max(0, control.index - 800), control.index);
  return /<AccessibleField\b[^<]*>\s*$/.test(before);
}

function attributeValue(markup: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrPattern = String.raw`(?:^|\s)${escapedName}=`;
  const quoted = markup.match(new RegExp(`${attrPattern}"([^"]+)"`));
  if (quoted) return quoted[1];

  const braced = markup.match(new RegExp(`${attrPattern}\\{([^}]+)\\}`));
  return braced?.[1];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `<AccessibleField id=...>` renders `<Label htmlFor={id}>` for its child control. */
function hasAccessibleFieldLabel(source: string, idValue: string) {
  const escaped = escapeRegExp(idValue);
  return new RegExp(`<AccessibleField\\b[^<]*?\\bid=(?:"${escaped}"|\\{${escaped})`).test(source);
}

function hasMatchingLabel(source: string, idValue: string) {
  if (hasAccessibleFieldLabel(source, idValue)) return true;

  // Braced ids can be template literals or expressions such as `ids.description`.
  return source.includes(`htmlFor={${idValue}}`) || source.includes(`htmlFor="${idValue}"`);
}

/** `AccessibleField` wires aria-describedby and renders its error with role="alert". */
function usesAccessibleFieldErrors(source: string) {
  return /<AccessibleField\b[^<]*?\berror=/.test(source);
}

describe("form accessibility and submit feedback", () => {
  it("uses deterministic invoice line DOM ids for SSR-safe hydration", () => {
    const source = sourceFor("src/components/create-invoice-form.tsx");

    expect(source).not.toMatch(/invoice-line-\$\{field\.id\}-/);
  });

  it.each([
    ["src/components/purchases/create-purchase-order-form.tsx", "<PurchaseOrderForm"],
    ["src/components/purchases/edit-purchase-order-form.tsx", "<PurchaseOrderForm"],
    ["src/components/sales/create-sales-quote-form.tsx", "<SalesDocumentForm"],
    ["src/components/sales/create-sales-order-form.tsx", "<SalesDocumentForm"],
  ])("%s delegates to the shared, covered document editor", (path, editor) => {
    const source = sourceFor(path);
    expect(source).toContain(editor);
    expect(formControls(source), `${path} must not render its own unchecked controls`).toHaveLength(0);
  });

  it.each(coveredForms)("%s names every inspected form control with a label or aria-label", (path) => {
    const source = sourceFor(path);
    const controls = formControls(source);

    expect(controls.length, `${path} should render inspected form controls`).toBeGreaterThan(0);

    for (const control of controls) {
      const ariaLabel = attributeValue(control.markup, "aria-label");
      const id = attributeValue(control.markup, "id");

      expect(
        Boolean(ariaLabel) || Boolean(id && hasMatchingLabel(source, id)) || isAccessibleFieldChild(source, control),
        `${path} has a control without a matching Label htmlFor or aria-label: ${control.markup}`,
      ).toBe(true);
    }
  });

  it.each(coveredForms)("%s avoids placeholder-only names", (path) => {
    const source = sourceFor(path);

    for (const control of formControls(source)) {
      if (control.markup.includes("placeholder=")) {
        const ariaLabel = attributeValue(control.markup, "aria-label");
        const id = attributeValue(control.markup, "id");

        expect(
          Boolean(ariaLabel) || Boolean(id && hasMatchingLabel(source, id)) || isAccessibleFieldChild(source, control),
          `${path} placeholder control needs a real accessible name: ${control.markup}`,
        ).toBe(true);
      }
    }
  });

  it.each(coveredForms)("%s associates submit errors where practical", (path) => {
    const source = sourceFor(path);

    if (source.includes("setError") || source.includes("formState: { errors")) {
      if (usesAccessibleFieldErrors(source)) return;
      expect(source, `${path} should expose error state through aria-describedby`).toMatch(/aria-describedby=/);
      expect(source, `${path} should render errors with alert semantics`).toMatch(/role="alert"/);
    }
  });

  it.each(coveredForms)("%s checks fetch responses and reports success/error feedback", (path) => {
    const source = sourceFor(path);

    if (!source.includes("fetch(")) {
      return;
    }

    expect(source, `${path} submit fetch must branch on response.ok`).toMatch(/\.ok\b/);
    expect(source, `${path} should show success feedback`).toMatch(/toast\.success/);
    expect(source, `${path} should show error feedback`).toMatch(/toast\.error/);
  });
});
