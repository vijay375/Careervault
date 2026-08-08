import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Magic-link signup was removed. Use POST /api/auth/signup instead. */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      reason: "disabled",
      message:
        "Email verification is no longer required. Create your account with role, email, and password.",
    },
    { status: 410 },
  );
}

export async function POST() {
  return GET();
}
