import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Magic-link / OTP signup verification was removed. */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      message:
        "Email verification is no longer required. Create your account with role, email, and password.",
    },
    { status: 410 },
  );
}
