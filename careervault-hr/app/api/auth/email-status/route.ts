import { NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { getRequestEmailStatus } from "@/lib/request-email";

export const runtime = "nodejs";

export async function GET() {
  return handleApiOperation("hr email status", async () => {
    return NextResponse.json(getRequestEmailStatus());
  });
}
