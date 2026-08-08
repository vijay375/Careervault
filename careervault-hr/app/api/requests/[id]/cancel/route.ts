import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { cancelDocumentRequest } from "@/lib/document-requests";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApiOperation("cancel request", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    const { id } = await context.params;
    const result = await cancelDocumentRequest(id, user.id);

    return NextResponse.json(
      {
        ok: result.ok,
        message: result.message,
        request: result.ok ? result.request : undefined,
      },
      { status: result.status },
    );
  });
}
