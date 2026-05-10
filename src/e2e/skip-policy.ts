import * as path from "node:path";

export type SkippedE2ETest = {
  file: string;
  title: string;
};

function normalizePath(file: string): string {
  return file.split(path.sep).join("/");
}

function skipKey(skip: SkippedE2ETest): string {
  return `${path.basename(skip.file)}::${skip.title}`;
}

export function findBlockingSkips(skipped: SkippedE2ETest[], allowlist: string[] = []): SkippedE2ETest[] {
  const allowed = new Set(allowlist.filter(Boolean));

  return skipped.filter((skip) => {
    const normalized = normalizePath(skip.file);
    if (!normalized.includes("tests/e2e/")) return false;

    return !allowed.has(skipKey(skip)) && !allowed.has(`${normalized}::${skip.title}`);
  });
}

export function formatSkipPolicyFailure(blocking: SkippedE2ETest[]): string {
  if (blocking.length === 0) return "";

  const details = blocking.map((skip) => `- ${path.basename(skip.file)} :: ${skip.title}`).join("\n");

  return [
    "Playwright mandatory skip policy failed.",
    "Mandatory e2e specs must not be silently skipped. Fix the fixture/data dependency or add an explicit reviewed allowlist entry.",
    details,
  ].join("\n");
}

export function parseSkipAllowlist(value: string | undefined): string[] {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}
