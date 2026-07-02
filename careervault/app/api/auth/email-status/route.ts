import { NextResponse } from "next/server";
import { getEmailServiceStatus } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getEmailServiceStatus());
}
