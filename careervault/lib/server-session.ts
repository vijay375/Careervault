import { NextRequest, NextResponse } from "next/server";
import {
  deleteSession,
  getSessionUser,
  sessionCookieName,
  type PublicUser,
} from "@/lib/server-auth";

const useSecureCookies = process.env.VERCEL === "1";

export async function requireUser(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName)?.value;
  const user = await getSessionUser(token);

  return user;
}

export function setSessionCookie(
  response: NextResponse,
  session: { token: string; expiresAt: number },
) {
  response.cookies.set(sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies,
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
