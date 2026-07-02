import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);

  if (!user) {
    return NextResponse.json({ ok: false, user: null }, { status: 401 });
  }

  return NextResponse.json({ ok: true, user });
}
