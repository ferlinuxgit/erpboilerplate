import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { session } from "@/db/schema";
import { AUTH_TOKEN_COOKIE, hashAuthToken } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST() {
  const token = (await cookies()).get(AUTH_TOKEN_COOKIE)?.value;
  if (token) await db.delete(session).where(eq(session.token, hashAuthToken(token)));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
