import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export async function getUserSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session;
}

export async function requireUserSession() {
  const session = await getUserSession();

  if (!session?.user) {
    redirect("/auth/login");
  }

  return session;
}
