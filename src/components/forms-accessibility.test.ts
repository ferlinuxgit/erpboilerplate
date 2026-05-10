import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const coveredForms = [
  "src/components/create-invoice-form.tsx",
  "src/components/invoices/edit-invoice-form.tsx",
  "src/components/treasury/create-bank-transaction-form.tsx",
  "src/components/treasury/edit-bank-transaction-form.tsx",
  "src/components/fiscal/create-fiscal-report-form.tsx",
  "src/components/fiscal/edit-fiscal-report-form.tsx",
  "src/components/purchases/create-purchase-order-form.tsx",
  "src/components/purchases/edit-purchase-order-form.tsx",
  "src/components/accounting/edit-account-form.tsx",
  "src/components/accounting/edit-journal-entry-form.tsx",
];

function sourceFor(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function formControls(source: string) {
  return Array.from(source.matchAll(/<(Input|select|textarea)\b[\s\S]*?(?:\/>|>)/g)).map((match) => match[0]);
}

function attributeValue(markup: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrPattern = String.raw`(?:^|\s)${escapedName}=`;
  const quoted = markup.match(new RegExp(`${attrPattern}"([^"]+)"`));
  if (quoted) return quoted[1];

  const braced = markup.match(new RegExp(`${attrPattern}\\{([^}]+)\\}`));
  return braced?.[1];
}

function hasMatchingLabel(source: string, idValue: string) {
  if (idValue.startsWith("`")) {
    return source.includes(`htmlFor={${idValue}}`);
  }

  return source.includes(`htmlFor="${idValue}"`);
}

describe("form accessibility and submit feedback", () => {
  it("uses deterministic invoice line DOM ids for SSR-safe hydration", () => {
    const source = sourceFor("src/components/create-invoice-form.tsx");

    expect(source).not.toMatch(/invoice-line-\$\{field\.id\}-/);
  });

  it.each(coveredForms)("%s names every inspected form control with a label or aria-label", (path) => {
    const source = sourceFor(path);
    const controls = formControls(source);

    expect(controls.length, `${path} should render inspected form controls`).toBeGreaterThan(0);

    for (const control of controls) {
      const ariaLabel = attributeValue(control, "aria-label");
      const id = attributeValue(control, "id");

      expect(
        Boolean(ariaLabel) || Boolean(id && hasMatchingLabel(source, id)),
        `${path} has a control without a matching Label htmlFor or aria-label: ${control}`,
      ).toBe(true);
    }
  });

  it.each(coveredForms)("%s avoids placeholder-only names", (path) => {
    const source = sourceFor(path);

    for (const control of formControls(source)) {
      if (control.includes("placeholder=")) {
        const ariaLabel = attributeValue(control, "aria-label");
        const id = attributeValue(control, "id");

        expect(
          Boolean(ariaLabel) || Boolean(id && hasMatchingLabel(source, id)),
          `${path} placeholder control needs a real accessible name: ${control}`,
        ).toBe(true);
      }
    }
  });

  it.each(coveredForms)("%s associates submit errors where practical", (path) => {
    const source = sourceFor(path);

    if (source.includes("setError") || source.includes("formState: { errors")) {
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
