export type RuntimeConfigStatus = "ok" | "missing_configuration" | "insecure_configuration";

export function getBuildSha() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RENDER_GIT_COMMIT ??
    process.env.GIT_SHA ??
    "unknown"
  ).slice(0, 7);
}

export function checkAuthRuntimeConfiguration(): RuntimeConfigStatus {
  const secret = process.env.JWT_SECRET?.trim() ?? "";
  const appUrl = process.env.APP_URL?.trim() ?? "";

  if (!secret || !appUrl) {
    return "missing_configuration";
  }

  if (secret.length < 32) {
    return "insecure_configuration";
  }

  if (process.env.NODE_ENV === "production") {
    if (!isHttpsOrLocal(appUrl)) {
      return "insecure_configuration";
    }
  }

  return "ok";
}

function isHttpsOrLocal(value: string) {
  return value.startsWith("https://") || value.includes("localhost") || value.includes("127.0.0.1");
}
