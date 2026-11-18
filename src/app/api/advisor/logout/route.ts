import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ADVISOR_LOGIN_PATH } from "@/lib/advisor-scopes";
import { ADVISOR_COOKIE, advisorCookieOptions, signOutAdvisor } from "@/server/advisor/auth";
import { httpErrorResponse } from "@/lib/http";

export async function POST() {
  try {
    await signOutAdvisor((await cookies()).get(ADVISOR_COOKIE)?.value);
    const response = NextResponse.json({ redirectTo: ADVISOR_LOGIN_PATH });
    response.cookies.set(ADVISOR_COOKIE, "", { ...advisorCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return httpErrorResponse(error);
  }
}
