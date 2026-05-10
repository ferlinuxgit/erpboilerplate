import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_TOKEN_COOKIE, verifyAuthToken } from "@/lib/auth";

function bearerToken(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

export async function getUserSession() {
  const requestHeaders = await headers();
  const requestCookies = await cookies();
  const token = bearerToken(requestHeaders.get("authorization")) ?? requestCookies.get(AUTH_TOKEN_COOKIE)?.value;

  return verifyAuthToken(token);
}

export async function requireUserSession() {
  const session = await getUserSession();

  if (!session?.user) {
    redirect("/auth/login");
  }

  return session;
}
