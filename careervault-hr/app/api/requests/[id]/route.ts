import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import {
  completeDocumentRequest,
  getDocumentRequestById,
} from "@/lib/document-requests";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApiOperation("request detail lookup", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    const { id } = await context.params;
    const record = await getDocumentRequestById(id, user.id);

    if (!record) {
      return NextResponse.json({ ok: false, message: "Request not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, request: record });
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleApiOperation("request status update", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    const { id } = await context.params;
    const body = (await request.json()) as { status?: string };
    if (body.status !== "completed") {
      return NextResponse.json(
        { ok: false, message: "The only manual status update supported is Completed." },
        { status: 400 },
      );
    }

    const result = await completeDocumentRequest(id, user.id);
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
