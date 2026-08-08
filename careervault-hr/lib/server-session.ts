import { NextRequest, NextResponse } from "next/server";
import {
  deleteHrSession,
  getHrSessionUser,
  hrSessionCookieName,
  type HrUser,
} from "@/lib/hr-auth";
import { withBasePath } from "@/lib/base-path";

const useSecureCookies = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
const sessionCookieDomain = process.env.SESSION_COOKIE_DOMAIN?.trim() || undefined;

export async function requireHrUser(request: NextRequest) {
  const token = request.cookies.get(hrSessionCookieName)?.value;
  return getHrSessionUser(token);
}

export function setHrSessionCookie(
  response: NextResponse,
  session: { token: string; expiresAt: number },
) {
  response.cookies.set(hrSessionCookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    domain: sessionCookieDomain,
    path: "/",
    expires: new Date(session.expiresAt),
  });
}

export async function clearHrSessionCookie(request: NextRequest, response: NextResponse) {
  await deleteHrSession(request.cookies.get(hrSessionCookieName)?.value);
  response.cookies.set(hrSessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    domain: sessionCookieDomain,
    path: "/",
    expires: new Date(0),
  });
}

export function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      message: "Your recruiter session is missing or does not have access to the HR Portal.",
      loginUrl: withBasePath("/login"),
    },
    { status: 401 },
  );
}

export type AuthenticatedHrUser = HrUser;
