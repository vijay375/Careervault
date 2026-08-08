import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleApiOperation("session lookup", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    return NextResponse.json({ ok: true, user });
  });
}
