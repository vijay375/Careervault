import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/server-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true, message: "Signed out securely." });
  await clearSessionCookie(request, response);
  return response;
}
