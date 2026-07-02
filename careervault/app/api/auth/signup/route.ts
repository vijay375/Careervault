import { NextRequest, NextResponse } from "next/server";
import { createAccount } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await createAccount({
      name: String(body.name || ""),
      email: String(body.email || ""),
      password: String(body.password || ""),
    });

    return NextResponse.json(result, { status: result.status });
  } catch {
    return NextResponse.json(
      { ok: false, message: "We could not create your account. Please try again." },
      { status: 500 },
    );
  }
}
