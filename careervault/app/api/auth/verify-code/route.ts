import { NextRequest, NextResponse } from "next/server";
import { verifyPasswordResetCode } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await verifyPasswordResetCode(
      String(body.email || ""),
      String(body.code || ""),
    );

    return NextResponse.json(result, { status: result.status });
  } catch {
    return NextResponse.json(
      { ok: false, message: "We could not verify the code. Please try again." },
      { status: 500 },
    );
  }
}
