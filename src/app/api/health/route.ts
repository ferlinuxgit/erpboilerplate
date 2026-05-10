const SERVICE_NAME = "erpboilerplate";

export const dynamic = "force-dynamic";

function getBuildSha() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RENDER_GIT_COMMIT ??
    process.env.GIT_SHA ??
    "unknown"
  ).slice(0, 7);
}

export function GET() {
  return Response.json({
    service: SERVICE_NAME,
    status: "ok",
    checks: {
      process: "ok",
    },
    version: {
      sha: getBuildSha(),
    },
  });
}
