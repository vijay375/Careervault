export type {
  EmailProviderName,
  EmailSendResult,
  EmailServiceStatus,
  RequestEmailContent,
} from "@shared/email-delivery";

export {
  getFriendlyEmailDeliveryMessage,
  getRequestEmailStatus,
  sendTransactionalEmail,
} from "@shared/email-delivery";

export {
  buildCandidateRequestEmail,
  buildHrSubmissionEmail,
} from "@shared/document-request-emails";

import type { RequestEmailContent } from "@shared/email-delivery";
import { sendTransactionalEmail } from "@shared/email-delivery";

/** Candidate/HR request emails always require live provider delivery. */
export async function sendRequestEmail(
  to: string,
  content: RequestEmailContent,
  options: { idempotencyKey: string; requireLiveDelivery?: boolean },
) {
  return sendTransactionalEmail(to, content, {
    idempotencyKey: options.idempotencyKey,
    requireLiveDelivery: options.requireLiveDelivery ?? true,
  });
}
