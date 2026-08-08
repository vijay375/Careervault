import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import {
  recordCandidateEmailDelivery,
  resolveRegisteredCandidateAccount,
  resendDocumentRequest,
} from "@/lib/document-requests";
import { getUserPortalUrl } from "@/lib/hr-data";
import {
  buildCandidateRequestEmail,
  getFriendlyEmailDeliveryMessage,
  getRequestEmailStatus,
  sendRequestEmail,
} from "@/lib/request-email";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function formatHrName(user: { name: string; firstName?: string; lastName?: string }) {
  const first = String(user.firstName || user.name || "").trim();
  const last = String(user.lastName || "").trim();
  return [first, last].filter(Boolean).join(" ") || user.name || "HR";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApiOperation("resend request", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { idempotencyKey?: string };
    const result = await resendDocumentRequest(
      id,
      {
        userPortalUrl: getUserPortalUrl(),
      },
      user.id,
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.message },
        { status: result.status },
      );
    }

    // Re-bind to the registered account email associated with this request.
    const accountResult = await resolveRegisteredCandidateAccount({
      candidateEmail: result.request.candidateEmail,
    });
    const recipientEmail = accountResult.ok
      ? accountResult.account.email
      : normalizeEmail(result.request.candidateEmail);

    if (!recipientEmail) {
      return NextResponse.json(
        { ok: false, message: "This request has no candidate email to deliver to." },
        { status: 400 },
      );
    }

    const emailResult = await sendRequestEmail(
      recipientEmail,
      buildCandidateRequestEmail({
        candidateName: result.request.candidateName,
        hrName: formatHrName(user),
        documents: result.request.items.map((item) => item.documentLabel),
        expiresAt: result.request.expiresAt,
        requestLink: result.requestLink,
      }),
      {
        idempotencyKey: `candidate-resend/${id}/${body.idempotencyKey || result.tokenId || "manual"}`,
      },
    );
    await recordCandidateEmailDelivery({
      requestId: result.request.id,
      tokenId: result.tokenId,
      recipientEmail,
      result: emailResult,
    });

    const emailStatus = getRequestEmailStatus();
    const failureDetail =
      !emailResult.ok && "detail" in emailResult ? String(emailResult.detail || "") : "";
    const failureMessage = emailResult.ok
      ? ""
      : getFriendlyEmailDeliveryMessage(emailResult.error, failureDetail);

    return NextResponse.json(
      {
        ok: emailResult.ok,
        emailSent: emailResult.ok,
        recipientEmail,
        message: emailResult.ok
          ? `Request email resent successfully to ${recipientEmail}.`
          : `Email delivery failed for ${recipientEmail}. ${failureMessage || emailStatus.setupHint}`,
        request: result.request,
        emailError: emailResult.ok ? undefined : emailResult.error,
      },
      { status: emailResult.ok ? 200 : 502 },
    );
  });
}
