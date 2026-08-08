import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { getSubmittedDocumentForDownload } from "@/lib/document-requests";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApiOperation("submitted document download", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    const { id } = await context.params;
    const fileId = request.nextUrl.searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json(
        { ok: false, message: "Select a submitted document to download." },
        { status: 400 },
      );
    }

    const selected = await getSubmittedDocumentForDownload(id, fileId, user.id);

    if (!selected) {
      return NextResponse.json({ ok: false, message: "File not found." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(selected.data), {
      headers: {
        "Content-Type": selected.mimeType || "application/octet-stream",
        "Content-Disposition": `${request.nextUrl.searchParams.get("preview") === "1" ? "inline" : "attachment"}; filename="${selected.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
