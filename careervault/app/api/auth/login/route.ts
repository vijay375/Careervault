import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await authenticateUser(
      String(body.email || ""),
      String(body.password || ""),
    );

    return NextResponse.json(result, { status: result.status });
  } catch {
    return NextResponse.json(
      { ok: false, message: "We could not sign you in. Please try again." },
      { status: 500 },
    );
  }
}
