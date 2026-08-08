import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { authenticateHrUser } from "@/lib/hr-auth";
import { setHrSessionCookie } from "@/lib/server-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleApiOperation("hr login", async () => {
    const body = await request.json();
    const result = await authenticateHrUser(
      String(body.email || ""),
      String(body.password || ""),
    );

    const response = NextResponse.json(
      {
        ok: result.ok,
        message: result.message,
        user: result.ok ? result.user : undefined,
      },
      { status: result.status },
    );

    if (result.ok && result.session) {
      setHrSessionCookie(response, result.session);
    }

    return response;
  });
}
