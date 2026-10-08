import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildNavigationCommands, quickActions, rankCommands } from "@/components/layout/command-search";
import { settingsSections, visibleSettingsSections } from "@/components/settings/settings-catalog";

const appDir = path.join(process.cwd(), "src/app");

function pageFile(route: string) {
  return path.join(appDir, route, "page.tsx");
}

describe("settings catalog", () => {
  it("points every entry to an existing page and, for anchors, to a section with that id", () => {
    for (const section of settingsSections) {
      if (section.href) expect(existsSync(pageFile(section.href)), section.href).toBe(true);
      for (const item of section.items) {
        const [route, anchor] = item.href.split("#");
        expect(existsSync(pageFile(route)), item.href).toBe(true);
        if (anchor) expect(readFileSync(pageFile(route), "utf8"), item.href).toContain(`id="${anchor}"`);
      }
    }
  });

  it("lists each setting once", () => {
    const hrefs = settingsSections.flatMap((section) => section.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("shows each role only what it can change and hides stock settings for service businesses", () => {
    const ids = (role: string, businessType = "both") => visibleSettingsSections({ role, businessType }).map((section) => section.id);
    expect(ids("OWNER")).toEqual(settingsSections.map((section) => section.id));
    expect(ids("OWNER", "services")).not.toContain("inventory");
    expect(ids("ACCOUNTANT")).toEqual(expect.arrayContaining(["fiscal", "payments", "banks", "security"]));
    expect(ids("ACCOUNTANT")).not.toContain("company");
    expect(ids("ACCOUNTANT")).not.toContain("billing");
    const fiscalForViewer = visibleSettingsSections({ role: "VIEWER" }).find((section) => section.id === "fiscal");
    expect(fiscalForViewer).toBeUndefined();
  });

  it("makes every setting findable from the command palette by plain words", () => {
    const catalog = [...quickActions, ...buildNavigationCommands()];
    const first = (query: string) => rankCommands(catalog, query).map((command) => command.href);
    expect(first("iban")).toContain("/settings/payments#formas-de-pago");
    expect(first("logo")).toContain("/settings/documents#logo");
    expect(first("numeracion")).toContain("/settings/documents#series");
    expect(first("verifactu")).toContain("/settings/fiscal#verifactu");
    expect(first("openai")).toContain("/settings/automation#ocr");
  });
});
