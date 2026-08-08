import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { getDocumentRequestByToken } from "@/lib/document-requests";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  return handleApiOperation("document request lookup", async () => {
    const { token } = await context.params;
    const request = await getDocumentRequestByToken(token);

    if (!request) {
      return NextResponse.json(
        { ok: false, message: "This request link is invalid." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      request: {
        id: request.id,
        candidateName: request.candidateName,
        candidateEmail: request.candidateEmail,
        status: request.status,
        expiresAt: request.expiresAt,
        submittedAt: request.submittedAt,
        items: request.items.map((item) => ({
          id: item.id,
          documentLabel: item.documentLabel,
          isCustom: item.isCustom,
        })),
      },
    });
  });
}
