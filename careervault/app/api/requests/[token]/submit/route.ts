import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { submitDocumentRequest } from "@/lib/document-requests";
import { requireUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApiOperation("document request submission", async () => {
    const user = await requireUser(request);

    if (!user) {
      return unauthorized();
    }

    const { token } = await context.params;
    const body = (await request.json()) as {
      submissions?: Array<{ itemId: string; documentId: string }>;
    };

    if (!body.submissions?.length) {
      return NextResponse.json(
        { ok: false, message: "Please attach a document for each requested item." },
        { status: 400 },
      );
    }

    const result = await submitDocumentRequest({
      token,
      userId: user.id,
      userEmail: user.email,
      submissions: body.submissions,
    });

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
