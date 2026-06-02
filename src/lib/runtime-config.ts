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
  const secret = process.env.BETTER_AUTH_SECRET?.trim() ?? "";
  const authUrl = process.env.BETTER_AUTH_URL?.trim() ?? "";
  const publicAuthUrl = process.env.NEXT_PUBLIC_BETTER_AUTH_URL?.trim() ?? "";

  if (!secret || !authUrl || !publicAuthUrl) {
    return "missing_configuration";
  }

  if (secret.length < 32) {
    return "insecure_configuration";
  }

  if (normalizeUrl(authUrl) !== normalizeUrl(publicAuthUrl)) {
    return "insecure_configuration";
  }

  if (process.env.NODE_ENV === "production") {
    if (!isHttpsOrLocal(authUrl) || !isHttpsOrLocal(publicAuthUrl)) {
      return "insecure_configuration";
    }
  }

  return "ok";
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isHttpsOrLocal(value: string) {
  return value.startsWith("https://") || value.includes("localhost") || value.includes("127.0.0.1");
}
