import { NextRequest, NextResponse } from "next/server";
import { getDocumentFile } from "@/lib/server-auth";
import { requireUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await requireUser(request);

  if (!user) {
    return unauthorized();
  }

  const { id } = await context.params;
  const file = await getDocumentFile(user.id, id);

  if (!file) {
    return NextResponse.json({ ok: false, message: "File not found." }, { status: 404 });
  }

  return new NextResponse(file.data, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
