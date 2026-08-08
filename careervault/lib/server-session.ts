import { NextRequest, NextResponse } from "next/server";
import {
  deleteSession,
  getSessionUser,
  sessionCookieName,
  type AccountRole,
  type PublicUser,
} from "@/lib/server-auth";

const useSecureCookies = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
const sessionCookieDomain = process.env.SESSION_COOKIE_DOMAIN?.trim() || undefined;

export async function requireUser(
  request: NextRequest,
  requiredRole: AccountRole | null = "employee",
) {
  const token = request.cookies.get(sessionCookieName)?.value;
  const user = await getSessionUser(token);

  return user && (!requiredRole || user.role === requiredRole) ? user : null;
}

export function setSessionCookie(
  response: NextResponse,
  session: { token: string; expiresAt: number },
) {
  response.cookies.set(sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
    domain: sessionCookieDomain,
    path: "/",
    expires: new Date(session.expiresAt),
  });
}

export async function clearSessionCookie(request: NextRequest, response: NextResponse) {
  await deleteSession(request.cookies.get(sessionCookieName)?.value);
  response.cookies.set(sessionCookieName, "", {
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
    { ok: false, message: "Your session has expired. Please sign in again." },
    { status: 401 },
  );
}

export type AuthenticatedUser = PublicUser;
