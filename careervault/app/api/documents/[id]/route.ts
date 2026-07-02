import { NextRequest, NextResponse } from "next/server";
import {
  deleteDocument,
  markDocumentViewed,
  updateDocument,
  type StoredDocument,
} from "@/lib/server-auth";
import { requireUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await requireUser(request);

  if (!user) {
    return unauthorized();
  }

  const { id } = await context.params;
  const body = (await request.json()) as Partial<StoredDocument> & {
    action?: "viewed";
  };

  if (body.action === "viewed") {
    const document = await markDocumentViewed(user.id, id);
    return document
      ? NextResponse.json({ ok: true, document })
      : NextResponse.json({ ok: false, message: "Document not found." }, { status: 404 });
  }

  const document = await updateDocument(user.id, { ...(body as StoredDocument), id });

  return document
    ? NextResponse.json({ ok: true, document })
    : NextResponse.json({ ok: false, message: "Document not found." }, { status: 404 });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await requireUser(request);

  if (!user) {
    return unauthorized();
  }

  const { id } = await context.params;
  await deleteDocument(user.id, id);
  return NextResponse.json({ ok: true });
}
