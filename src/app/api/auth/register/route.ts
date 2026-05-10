import * as argon2 from "argon2";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { account, user } from "@/db/schema";
import { createAuthToken, getAuthCookieOptions, AUTH_TOKEN_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { authSignUpSchema } from "@/server/schemas/forms";

export async function POST(request: Request) {
  const parsed = authSignUpSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de registro inválidos." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: "Ya existe una cuenta con ese email." }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  const now = new Date();
  const passwordHash = await argon2.hash(parsed.data.password);

  const [createdUser] = await db
    .insert(user)
    .values({
      id: userId,
      name: parsed.data.name.trim(),
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: user.id, name: user.name, email: user.email });

  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: email,
    providerId: "credential",
    userId: createdUser.id,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  const token = createAuthToken(createdUser);
  const response = NextResponse.json({ user: createdUser });
  response.cookies.set(AUTH_TOKEN_COOKIE, token, getAuthCookieOptions());

  return response;
}
