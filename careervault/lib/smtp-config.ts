export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
};

export type EmailDeliveryStatus = {
  configured: boolean;
  provider: "smtp" | "brevo-api" | "none";
  hostConfigured: boolean;
  port: number | null;
  userConfigured: boolean;
  passwordConfigured: boolean;
  fromConfigured: boolean;
  fromEmail: string | null;
  fromName: string | null;
  brevoApiConfigured: boolean;
  missing: string[];
};

/** @deprecated Use EmailDeliveryStatus */
export type SmtpConfigStatus = EmailDeliveryStatus;

function readEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function resolveSmtpFromAddress() {
  const legacyFrom = readEnv("SMTP_FROM");
  if (legacyFrom) {
    return legacyFrom;
  }

  const fromEmail = readEnv("SMTP_FROM_EMAIL");
  const fromName = readEnv("SMTP_FROM_NAME");

  if (fromEmail && fromName) {
    return `${fromName} <${fromEmail}>`;
  }

  if (fromEmail) {
    return fromEmail;
  }

  return "";
}

export function resolveSenderIdentity() {
  const fromEmail = readEnv("SMTP_FROM_EMAIL");
  const fromName = readEnv("SMTP_FROM_NAME") || "CareerVault";
  const legacyFrom = readEnv("SMTP_FROM");

  if (fromEmail) {
    return { fromEmail, fromName, from: `${fromName} <${fromEmail}>` };
  }

  if (legacyFrom) {
    const match = legacyFrom.match(/^(.*?)<\s*([^>]+)\s*>$/);
    if (match) {
      return {
        fromName: match[1].trim().replace(/^"|"$/g, "") || "CareerVault",
        fromEmail: match[2].trim(),
        from: legacyFrom,
      };
    }

    return { fromName, fromEmail: legacyFrom, from: legacyFrom };
  }

  return { fromEmail: "", fromName, from: "" };
}

export function getBrevoApiKey() {
  return readEnv("BREVO_API_KEY");
}

export function getEmailDeliveryStatus(): EmailDeliveryStatus {
  const host = readEnv("SMTP_HOST");
  const portValue = readEnv("SMTP_PORT");
  const user = readEnv("SMTP_USER");
  const password = readEnv("SMTP_PASSWORD");
  const sender = resolveSenderIdentity();
  const brevoApiKey = getBrevoApiKey();
  const port = portValue ? Number(portValue) : null;

  const smtpMissing: string[] = [];
  if (!host) smtpMissing.push("SMTP_HOST");
  if (!portValue) smtpMissing.push("SMTP_PORT");
  if (!user) smtpMissing.push("SMTP_USER");
  if (!password) smtpMissing.push("SMTP_PASSWORD");
  if (!sender.fromEmail) smtpMissing.push("SMTP_FROM or SMTP_FROM_EMAIL");

  const smtpConfigured =
    smtpMissing.length === 0 && Boolean(port && Number.isFinite(port));
  const brevoApiConfigured = Boolean(brevoApiKey && sender.fromEmail);

  let provider: EmailDeliveryStatus["provider"] = "none";
  let configured = false;
  const missing: string[] = [];

  if (brevoApiConfigured) {
    provider = "brevo-api";
    configured = true;
  } else if (smtpConfigured) {
    provider = "smtp";
    configured = true;
  } else {
    missing.push(...smtpMissing);
    if (brevoApiKey && !sender.fromEmail) {
      missing.push("SMTP_FROM or SMTP_FROM_EMAIL");
    }
  }

  return {
    configured,
    provider,
    hostConfigured: Boolean(host),
    port,
    userConfigured: Boolean(user),
    passwordConfigured: Boolean(password),
    fromConfigured: Boolean(sender.fromEmail),
    fromEmail: sender.fromEmail || null,
    fromName: sender.fromName || null,
    brevoApiConfigured,
    missing: Array.from(new Set(missing)),
  };
}

export function getSmtpConfigStatus(): EmailDeliveryStatus {
  return getEmailDeliveryStatus();
}

export function getSmtpConfig(): SmtpConfig | null {
  const status = getEmailDeliveryStatus();

  if (status.provider !== "smtp" || status.port === null) {
    return null;
  }

  const host = readEnv("SMTP_HOST");
  const user = readEnv("SMTP_USER");
  const password = readEnv("SMTP_PASSWORD");
  const from = resolveSmtpFromAddress();
  const port = status.port;
  const secure = port === 465;

  return {
    host,
    port,
    user,
    password,
    from,
    secure,
  };
}

export type PasswordResetEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function buildPasswordResetEmailContent(
  userName: string,
  code: string,
  expiryMinutes: number,
  appUrl: string,
): PasswordResetEmailContent {
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
    html: [
      `<p>Hello ${escapeHtml(userName)},</p>`,
      `<p>Your CareerVault verification code is <strong>${escapeHtml(code)}</strong>.</p>`,
      `<p>It expires in ${expiryMinutes} minutes.</p>`,
      `<p><a href="${escapeHtml(appUrl)}">Open CareerVault</a> and enter this code on the Verify Code screen.</p>`,
      `<p>If you did not request this, you can ignore this email.</p>`,
    ].join(""),
  };
}

export async function sendViaBrevoApi({
  to,
  content,
}: {
  to: string;
  content: PasswordResetEmailContent;
}) {
  const apiKey = getBrevoApiKey();
  const sender = resolveSenderIdentity();

  if (!apiKey || !sender.fromEmail) {
    return {
      ok: false as const,
      mode: "unconfigured" as const,
      message: "Brevo API is not configured.",
    };
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: sender.fromName,
        email: sender.fromEmail,
      },
      to: [{ email: to }],
      subject: content.subject,
      textContent: content.text,
      htmlContent: content.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Brevo API ${response.status}: ${detail}`);
  }

  const result = (await response.json()) as { messageId?: string };
  return {
    ok: true as const,
    mode: "brevo-api" as const,
    messageId: result.messageId,
    accepted: [to],
    rejected: [] as string[],
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
