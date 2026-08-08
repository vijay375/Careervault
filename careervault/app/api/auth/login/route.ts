import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/server-auth";
import { setSessionCookie } from "@/lib/server-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await authenticateUser(
      String(body.email || ""),
      String(body.password || ""),
    );

    const response = NextResponse.json(
      {
        ok: result.ok,
        status: result.status,
        message: result.message,
        user: result.ok ? result.user : undefined,
      },
      { status: result.status },
    );

    if (result.ok && result.session) {
      setSessionCookie(response, result.session);
    }

    return response;
  } catch {
    return NextResponse.json(
      { ok: false, message: "We could not sign you in. Please try again." },
      { status: 500 },
    );
  }
}
