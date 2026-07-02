import { NextRequest, NextResponse } from "next/server";
import { resendPasswordResetCode } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await resendPasswordResetCode(String(body.email || ""));

    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("CareerVault resend-code request failed.", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          "We could not send a new verification code right now. Please try again shortly.",
      },
      { status: 502 },
    );
  }
}
