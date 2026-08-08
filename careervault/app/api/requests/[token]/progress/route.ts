import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { markDocumentRequestInProgress } from "@/lib/document-requests";
import { requireUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApiOperation("document request progress", async () => {
    const user = await requireUser(request);
    if (!user) {
      return unauthorized();
    }

    const { token } = await context.params;
    const result = await markDocumentRequestInProgress({
      token,
      userId: user.id,
      userEmail: user.email,
    });

    return NextResponse.json(
      { ok: result.ok, message: result.message },
      { status: result.status },
    );
  });
}
