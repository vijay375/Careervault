import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await requestPasswordReset(String(body.email || ""));

    return NextResponse.json(result, { status: result.status });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "We could not send the verification code right now. Please try again shortly.",
      },
      { status: 502 },
    );
  }
}
