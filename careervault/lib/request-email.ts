export type {
  EmailProviderName,
  EmailSendResult,
  EmailServiceStatus,
  RequestEmailContent,
} from "@shared/email-delivery";

export {
  getFriendlyEmailDeliveryMessage,
  getRequestEmailStatus,
  isDevelopmentEmailFallbackEnabled,
  isResendTestingSender,
  resolveTransactionalFromEmail,
  resolveTransactionalFromName,
  sendTransactionalEmail,
} from "@shared/email-delivery";

import type { RequestEmailContent } from "@shared/email-delivery";
import { sendTransactionalEmail } from "@shared/email-delivery";

export {
  buildCandidateRequestEmail,
  buildHrSubmissionEmail,
} from "@shared/document-request-emails";

/** Document-request emails require a real provider — never mock-success locally. */
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

export function buildPasswordResetEmailContent(
  userName: string,
  code: string,
  expiryMinutes: number,
  appUrl: string,
): RequestEmailContent {
  return {
    subject: "Your CareerVault password reset code",
    text: [
      `Hello ${userName},`,
      "",
      `Your CareerVault verification code is ${code}.`,
      `It expires in ${expiryMinutes} minutes.`,
      "",
      `Open CareerVault to enter your code: ${appUrl}`,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: emailFrame(`
      <p style="margin:0 0 8px;font-size:14px;color:#2563eb;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Password reset</p>
      <h1 style="margin:0 0 14px;font-size:26px;color:#0f172a">Hello, ${escapeHtml(userName)}</h1>
      <p style="margin:0;color:#475569;line-height:1.7">Use this CareerVault verification code:</p>
      <div style="margin:20px 0;padding:18px;border-radius:20px;background:#eff6ff;color:#1d4ed8;font-size:30px;font-weight:800;letter-spacing:.18em;text-align:center">${escapeHtml(code)}</div>
      <p style="margin:0 0 20px;color:#64748b;font-size:13px">The code expires in ${expiryMinutes} minutes.</p>
      <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:13px 22px;border-radius:20px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700">Open CareerVault</a>
      <p style="margin:22px 0 0;color:#64748b;font-size:12px">If you did not request this, you can ignore this email.</p>
    `),
  };
}

export function buildSignupMagicLinkEmailContent(
  userName: string,
  verifyUrl: string,
  expiryHours: number,
  supportEmail = "support@careervault.app",
): RequestEmailContent {
  return {
    subject: "Verify your CareerVault email address",
    text: [
      `Welcome to CareerVault, ${userName}!`,
      "",
      "Please verify your email address to finish creating your account.",
      `Verify Email: ${verifyUrl}`,
      "",
      `This link expires in ${expiryHours} hours and can only be used once.`,
      "",
      `If the button does not work, copy and paste this URL into your browser:`,
      verifyUrl,
      "",
      `If you did not create a CareerVault account, you can ignore this email.`,
      `Need help? Contact ${supportEmail}.`,
    ].join("\n"),
    html: emailFrame(`
      <p style="margin:0 0 8px;font-size:14px;color:#2563eb;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Welcome to CareerVault</p>
      <h1 style="margin:0 0 14px;font-size:26px;color:#0f172a">Hello, ${escapeHtml(userName)}</h1>
      <p style="margin:0 0 20px;color:#475569;line-height:1.7">Thanks for joining CareerVault. Confirm your email address to continue and create your password.</p>
      <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:14px 26px;border-radius:20px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;font-size:15px">Verify Email</a>
      <p style="margin:22px 0 8px;color:#64748b;font-size:13px">This link expires in <strong>${expiryHours} hours</strong> and can only be used once.</p>
      <p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.6">If the button does not work, copy and paste this URL into your browser:</p>
      <p style="margin:0;color:#2563eb;font-size:12px;line-height:1.6;word-break:break-all"><a href="${escapeHtml(verifyUrl)}" style="color:#2563eb">${escapeHtml(verifyUrl)}</a></p>
      <p style="margin:22px 0 0;color:#64748b;font-size:12px;line-height:1.6">If verification fails or you did not create this account, contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#2563eb">${escapeHtml(supportEmail)}</a>.</p>
    `),
  };
}

/** @deprecated OTP signup removed — use buildSignupMagicLinkEmailContent */
export function buildSignupVerificationEmailContent(
  userName: string,
  code: string,
  expiryMinutes: number,
  appUrl: string,
): RequestEmailContent {
  return buildSignupMagicLinkEmailContent(userName, appUrl, Math.max(1, Math.ceil(expiryMinutes / 60)));
}

function emailFrame(content: string) {
  return `<!doctype html>
  <html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif">
    <div style="padding:32px 16px">
      <div style="max-width:620px;margin:0 auto">
        <div style="padding:0 4px 18px;color:#0f172a;font-size:20px;font-weight:800">CareerVault</div>
        <div style="padding:30px;border-radius:24px;background:#fff;box-shadow:0 12px 30px rgba(15,23,42,.08)">${content}</div>
        <p style="margin:18px 4px 0;color:#94a3b8;font-size:12px">CareerVault · Secure career document management</p>
      </div>
    </div>
  </body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
