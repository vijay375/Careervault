import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import {
  createDocumentRequest,
  recordCandidateEmailDelivery,
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

function formatHrName(user: { name: string; firstName?: string; lastName?: string }) {
  const first = String(user.firstName || user.name || "").trim();
  const last = String(user.lastName || "").trim();
  return [first, last].filter(Boolean).join(" ") || user.name || "HR";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Document-request emails must go to the candidate account email stored on the request.
 * Never substitute the authenticated HR user's email unless that address is the intended recipient.
 */
function resolveCandidateRecipient(input: {
  requestCandidateEmail: string;
  hrEmail: string;
}) {
  const recipientEmail = normalizeEmail(input.requestCandidateEmail);
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return {
      ok: false as const,
      message: "The request is missing a valid candidate account email.",
    };
  }

  const hrEmail = normalizeEmail(input.hrEmail);
  if (hrEmail && recipientEmail === hrEmail) {
    // Allowed only when HR intentionally requested documents from their own account.
    return { ok: true as const, recipientEmail, isHrSelfRequest: true };
  }

  return { ok: true as const, recipientEmail, isHrSelfRequest: false };
}

export async function POST(request: NextRequest) {
  return handleApiOperation("create request", async () => {
    const user = await requireHrUser(request);

    if (!user) {
      return unauthorized();
    }

    const body = (await request.json()) as {
      candidateName?: string;
      candidateEmail?: string;
      candidateUserId?: string;
      documentLabels?: string[];
      customDocuments?: string[];
      expiryHours?: number;
      expiresAt?: string;
      replaceRequestId?: string;
    };

    const result = await createDocumentRequest(
      {
        candidateName: String(body.candidateName || ""),
        candidateEmail: String(body.candidateEmail || ""),
        candidateUserId:
          typeof body.candidateUserId === "string" ? body.candidateUserId : undefined,
        documentLabels: Array.isArray(body.documentLabels)
          ? body.documentLabels.filter((value): value is string => typeof value === "string")
          : [],
        customDocuments: Array.isArray(body.customDocuments)
          ? body.customDocuments.filter((value): value is string => typeof value === "string")
          : [],
        expiryHours: body.expiresAt ? undefined : Number(body.expiryHours || 24),
        expiresAt: body.expiresAt,
        replaceRequestId:
          typeof body.replaceRequestId === "string" ? body.replaceRequestId : undefined,
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

    const recipient = resolveCandidateRecipient({
      requestCandidateEmail: result.recipientEmail || result.request.candidateEmail,
      hrEmail: user.email,
    });
    if (!recipient.ok) {
      return NextResponse.json({ ok: false, message: recipient.message }, { status: 400 });
    }

    const recipientEmail = recipient.recipientEmail;
    const emailResult = await sendRequestEmail(
      recipientEmail,
      buildCandidateRequestEmail({
        candidateName: result.request.candidateName,
        hrName: formatHrName(user),
        documents: result.request.items.map((item) => item.documentLabel),
        expiresAt: result.request.expiresAt,
        requestLink: result.requestLink,
      }),
      { idempotencyKey: `candidate-request/${result.tokenId}` },
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
    const missingNote =
      !emailResult.ok && emailStatus.missing.length
        ? ` Missing: ${emailStatus.missing.join("; ")}.`
        : "";

    return NextResponse.json(
      {
        ok: true,
        emailSent: emailResult.ok,
        recipientEmail,
        candidateUserId: result.candidateUserId,
        message: emailResult.ok
          ? `Request sent successfully to ${recipientEmail}.`
          : `The request was created for ${recipientEmail}, but the email could not be sent. ${failureMessage}${missingNote}`,
        request: result.request,
        requestLink: result.requestLink,
        emailError: emailResult.ok ? undefined : emailResult.error,
        emailStatus: emailResult.ok
          ? undefined
          : {
              configured: emailStatus.configured,
              missing: emailStatus.missing,
              setupHint: emailStatus.setupHint,
            },
      },
      { status: emailResult.ok ? 201 : 202 },
    );
  });
}
