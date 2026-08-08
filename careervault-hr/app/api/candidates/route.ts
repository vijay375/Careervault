import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import {
  listDocumentRequests,
  type DisplayRequestStatus,
} from "@/lib/document-requests";
import { getUserPortalUrl } from "@/lib/hr-data";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleApiOperation("candidate list request", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    const params = request.nextUrl.searchParams;
    const result = await listDocumentRequests({
      search: params.get("search") || undefined,
      status: (params.get("status") as DisplayRequestStatus | "all") || "all",
      sortBy: (params.get("sortBy") as "name" | "requestDate" | "expiryDate") || "requestDate",
      sortDirection: (params.get("sortDirection") as "asc" | "desc") || "desc",
      page: Number(params.get("page") || 1),
      pageSize: Number(params.get("pageSize") || 10),
      userPortalUrl: getUserPortalUrl(),
      hrUserId: user.id,
    });

    return NextResponse.json({ ok: true, ...result });
  });
}
