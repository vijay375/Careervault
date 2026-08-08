import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { clearHrSessionCookie } from "@/lib/server-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleApiOperation("logout", async () => {
    const response = NextResponse.json({ ok: true, message: "Signed out successfully." });
    await clearHrSessionCookie(request, response);
    return response;
  });
}
