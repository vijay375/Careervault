import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { getDashboardStats } from "@/lib/document-requests";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleApiOperation("dashboard request", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    const stats = await getDashboardStats(user.id);
    return NextResponse.json({ ok: true, stats });
  });
}
