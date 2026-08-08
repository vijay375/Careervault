import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import {
  resolveRegisteredCandidateAccount,
  searchRegisteredCandidateAccounts,
} from "@/lib/document-requests";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleApiOperation("candidate account lookup", async () => {
    const user = await requireHrUser(request);
    if (!user) {
      return unauthorized();
    }

    const params = request.nextUrl.searchParams;
    const email = params.get("email")?.trim() || "";
    const userId = params.get("userId")?.trim() || "";
    const search = params.get("q")?.trim() || "";

    if (email || userId) {
      const result = await resolveRegisteredCandidateAccount({
        candidateEmail: email,
        candidateUserId: userId,
      });
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, message: result.message },
          { status: result.status },
        );
      }
      return NextResponse.json({ ok: true, account: result.account });
    }

    const accounts = await searchRegisteredCandidateAccounts(search);
    return NextResponse.json({ ok: true, accounts });
  });
}
