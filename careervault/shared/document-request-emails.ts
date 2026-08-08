import type { RequestEmailContent } from "./email-delivery";

export function buildCandidateRequestEmail(input: {
  candidateName: string;
  hrName: string;
  documents: string[];
  expiresAt: string;
  requestLink: string;
}): RequestEmailContent {
  const firstName = getFirstName(input.candidateName);
  const formattedExpiry = formatEmailDate(input.expiresAt);
  const documentListText = input.documents.map((document) => `- ${document}`).join("\n");
  const documentListHtml = input.documents
    .map(
      (document) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width:22px;vertical-align:top;padding-top:2px;">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#2563eb;"></span>
                </td>
                <td style="font-size:15px;line-height:1.5;color:#0f172a;font-weight:600;">
                  ${escapeHtml(document)}
                </td>
              </tr>
            </table>
          </td>
        </tr>`,
    )
    .join("");

  return {
    subject: `Document request from ${input.hrName} · CareerVault`,
    text: [
      `Hello ${firstName},`,
      "",
      `${input.hrName} has requested documents from you through CareerVault.`,
      "",
      "Requested documents:",
      documentListText,
      "",
      `Please submit before: ${formattedExpiry}`,
      "",
      `Submit your documents here: ${input.requestLink}`,
      "",
      "After you click the link, sign in with this email address, upload the requested files, and submit the request.",
      "This secure link is single-use and will stop working after submission or expiration.",
      "",
      "CareerVault · Secure career document management",
    ].join("\n"),
    html: emailShell({
      preheader: `${input.hrName} requested documents through CareerVault.`,
      title: "Document Request",
      body: `
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#2563eb;font-weight:700;">
          Document Request
        </p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;color:#0f172a;font-weight:800;">
          Hello, ${escapeHtml(firstName)}
        </h1>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#475569;">
          <strong style="color:#0f172a;">${escapeHtml(input.hrName)}</strong>
          has requested documents from you through CareerVault.
          Please review the list below and submit the files securely.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
          style="margin:0 0 22px;border:1px solid #e2e8f0;border-radius:20px;background:#f8fafc;">
          <tr>
            <td style="padding:18px 20px;">
              <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#0f172a;">
                Requested documents
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${documentListHtml}
              </table>
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
          style="margin:0 0 26px;border:1px solid #dbeafe;border-radius:20px;background:#eff6ff;">
          <tr>
            <td style="padding:16px 20px;">
              <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;font-weight:700;">
                Link expires
              </p>
              <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">
                ${escapeHtml(formattedExpiry)}
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
          <tr>
            <td align="center" bgcolor="#2563eb" style="border-radius:999px;">
              <a href="${escapeHtml(input.requestLink)}"
                style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">
                Submit Documents
              </a>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#64748b;">
          Clicking the button opens your secure request page. Sign in with
          <strong style="color:#0f172a;">this email address</strong>, upload each requested document,
          then submit the request for HR review.
        </p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;word-break:break-all;">
          If the button does not work, copy and paste this link into your browser:<br>
          <a href="${escapeHtml(input.requestLink)}" style="color:#2563eb;text-decoration:underline;">
            ${escapeHtml(input.requestLink)}
          </a>
        </p>
      `,
    }),
  };
}

export function buildHrSubmissionEmail(input: {
  hrName: string;
  candidateName: string;
  submittedAt: string;
  documentCount: number;
  hrPortalUrl: string;
}): RequestEmailContent {
  const firstName = getFirstName(input.hrName);
  const submittedAt = formatEmailDate(input.submittedAt);
  const reviewUrl = input.hrPortalUrl.includes("/candidates")
    ? input.hrPortalUrl
    : `${input.hrPortalUrl.replace(/\/$/, "")}/candidates`;

  return {
    subject: `${input.candidateName} submitted requested documents`,
    text: [
      `Hello ${firstName},`,
      "",
      `${input.candidateName} submitted ${input.documentCount} requested document(s).`,
      `Status: Submitted`,
      `Submitted at: ${submittedAt}`,
      `Review in CareerVault: ${reviewUrl}`,
    ].join("\n"),
    html: emailShell({
      preheader: `${input.candidateName} submitted the requested documents.`,
      title: "Submission received",
      body: `
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#2563eb;font-weight:700;">
          Submission received
        </p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;color:#0f172a;font-weight:800;">
          ${escapeHtml(input.candidateName)} submitted documents
        </h1>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#475569;">
          Hello ${escapeHtml(firstName)}, the candidate completed your CareerVault document request.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
          style="margin:0 0 24px;border:1px solid #e2e8f0;border-radius:20px;background:#f8fafc;">
          <tr>
            <td style="padding:18px 20px;font-size:14px;line-height:1.8;color:#334155;">
              <strong style="color:#0f172a;">Status:</strong> Submitted<br>
              <strong style="color:#0f172a;">Documents:</strong> ${input.documentCount}<br>
              <strong style="color:#0f172a;">Submitted:</strong> ${escapeHtml(submittedAt)}
            </td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" bgcolor="#2563eb" style="border-radius:999px;">
              <a href="${escapeHtml(reviewUrl)}"
                style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">
                Review submission
              </a>
            </td>
          </tr>
        </table>
      `,
    }),
  };
}

function emailShell(input: { preheader: string; title: string; body: string }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#0d172b;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(input.preheader)}
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0d172b;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;">
          <tr>
            <td style="padding:0 8px 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:42px;height:42px;border-radius:14px;background:#3b82f6;color:#ffffff;font-size:14px;font-weight:800;text-align:center;vertical-align:middle;">
                    CV
                  </td>
                  <td style="padding-left:12px;">
                    <div style="font-size:18px;font-weight:800;color:#ffffff;line-height:1.2;">CareerVault</div>
                    <div style="font-size:12px;color:#bfdbfe;line-height:1.4;">Secure Document Hub</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:24px;padding:32px 28px;box-shadow:0 18px 40px rgba(0,0,0,0.18);">
              ${input.body}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:#94a3b8;">
              CareerVault · Secure career document management<br>
              This message was sent because an HR user requested documents through CareerVault.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function getFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function formatEmailDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
