import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { createHrAccount } from "@/lib/hr-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleApiOperation("hr signup", async () => {
    const body = await request.json();
    const result = await createHrAccount({
      firstName: String(body.firstName || ""),
      lastName: String(body.lastName || ""),
      name: String(body.name || ""),
      email: String(body.email || ""),
      password: String(body.password || ""),
    });

    return NextResponse.json(
      { ok: result.ok, message: result.message },
      { status: result.status },
    );
  });
}
