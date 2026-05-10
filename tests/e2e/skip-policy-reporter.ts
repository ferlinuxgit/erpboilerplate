import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

import { findBlockingSkips, formatSkipPolicyFailure, parseSkipAllowlist, type SkippedE2ETest } from "../../src/e2e/skip-policy";

class MandatorySkipPolicyReporter implements Reporter {
  private skipped: SkippedE2ETest[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== "skipped") return;

    this.skipped.push({
      file: test.location.file,
      title: test.titlePath().join(" > "),
    });
  }

  async onEnd() {
    const allowlist = parseSkipAllowlist(process.env.E2E_ALLOWED_SKIPS);
    const blocking = findBlockingSkips(this.skipped, allowlist);

    if (blocking.length === 0) return;

    console.error(formatSkipPolicyFailure(blocking));
    return { status: "failed" as const };
  }
}

export default MandatorySkipPolicyReporter;
