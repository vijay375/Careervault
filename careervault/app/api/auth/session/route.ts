import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { requireUser } from "@/lib/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleApiOperation("session lookup", async () => {
    const user = await requireUser(request, null);

    if (!user) {
      return NextResponse.json({ ok: false, user: null }, { status: 401 });
    }

    return NextResponse.json({ ok: true, user });
  });
}
