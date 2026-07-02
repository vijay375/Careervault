import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await checkDatabaseConnection();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Database connection failed.",
        code:
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : undefined,
      },
      { status: 500 },
    );
  }
}
