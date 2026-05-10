import { describe, expect, it } from "vitest";

import { formatSkipPolicyFailure, findBlockingSkips } from "./skip-policy";

describe("Playwright mandatory skip policy", () => {
  it("blocks skipped tests in mandatory e2e specs", () => {
    const blocking = findBlockingSkips([
      {
        file: "/repo/tests/e2e/invoice-lines.spec.ts",
        title: "crear customer y factura con dos líneas persiste totales y líneas",
      },
    ]);

    expect(blocking).toHaveLength(1);
    expect(formatSkipPolicyFailure(blocking)).toContain("invoice-lines.spec.ts");
  });

  it("allows explicitly allowlisted skipped tests", () => {
    const skipped = {
      file: "/repo/tests/e2e/experimental-demo.spec.ts",
      title: "non mandatory exploratory flow",
    };

    expect(findBlockingSkips([skipped], ["experimental-demo.spec.ts::non mandatory exploratory flow"])).toEqual([]);
  });
});
