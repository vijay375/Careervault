import { NextRequest, NextResponse } from "next/server";
import { createAccount, type AccountRole } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await createAccount({
      email: String(body.email || ""),
      password: String(body.password || ""),
      role: String(body.role || "") as AccountRole,
      firstName: String(body.firstName || ""),
      lastName: String(body.lastName || ""),
      name: String(body.name || ""),
    });

    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("CareerVault account creation failed.", error);
    return NextResponse.json(
      { ok: false, message: "We could not create your account. Please try again." },
      { status: 500 },
    );
  }
}
