import { NextRequest, NextResponse } from "next/server";
import { createDocument, listDocuments, type StoredDocument } from "@/lib/server-auth";
import { requireUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);

  if (!user) {
    return unauthorized();
  }

  const documents = await listDocuments(user.id);
  return NextResponse.json({ ok: true, documents });
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);

  if (!user) {
    return unauthorized();
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const metadataValue = formData.get("metadata");

  if (!(file instanceof File) || (!metadataValue && typeof metadataValue !== "string")) {
    return NextResponse.json(
      { ok: false, message: "Please upload a file with document metadata." },
      { status: 400 },
    );
  }

  const metadataText =
    typeof metadataValue === "string" ? metadataValue : await metadataValue.text();
  let metadata: Omit<StoredDocument, "id" | "uploadedAt" | "fileUrl">;

  try {
    metadata = JSON.parse(metadataText) as Omit<
      StoredDocument,
      "id" | "uploadedAt" | "fileUrl"
    >;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Document metadata is invalid." },
      { status: 400 },
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const document = await createDocument(user, metadata, {
    data: buffer,
    mimeType: file.type || "application/octet-stream",
  });

  return NextResponse.json({ ok: true, document }, { status: 201 });
}
