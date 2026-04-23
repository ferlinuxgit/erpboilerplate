import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { createUploadUrl } from "@/server/storage/s3";

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const payload = (await request.json()) as { fileName?: string; contentType?: string };
  if (!payload.fileName?.trim() || !payload.contentType?.trim()) {
    return NextResponse.json({ message: "fileName y contentType son obligatorios." }, { status: 400 });
  }
  const key = `${session.user.id}/${Date.now()}-${payload.fileName}`;
  const url = await createUploadUrl(key, payload.contentType);
  return NextResponse.json({ key, url });
}
