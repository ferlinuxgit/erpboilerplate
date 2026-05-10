import * as argon2 from "argon2";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { account, user } from "@/db/schema";
import { AUTH_TOKEN_COOKIE, createAuthToken, getAuthCookieOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { authSignInSchema } from "@/server/schemas/forms";

export async function POST(request: Request) {
  const parsed = authSignInSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Credenciales inválidas." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      password: account.password,
    })
    .from(user)
    .innerJoin(account, and(eq(account.userId, user.id), isNotNull(account.password)))
    .where(eq(user.email, email))
    .limit(1);

  if (!row?.password) {
    return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
  }

  const validPassword = await argon2.verify(row.password, parsed.data.password).catch(() => false);

  if (!validPassword) {
    return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
  }

  const authUser = { id: row.id, name: row.name, email: row.email };
  const token = createAuthToken(authUser);
  const response = NextResponse.json({ user: authUser });
  response.cookies.set(AUTH_TOKEN_COOKIE, token, getAuthCookieOptions());

  return response;
}
