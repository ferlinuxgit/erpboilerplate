import { getBuildSha } from "@/lib/runtime-config";

const SERVICE_NAME = "erpboilerplate";
export const dynamic = "force-dynamic";

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
