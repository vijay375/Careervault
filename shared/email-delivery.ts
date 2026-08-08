export type RequestEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export type EmailProviderName = "brevo" | "development" | "resend" | "none";

export type EmailSendResult =
  | { ok: true; provider: "brevo" | "development" | "resend"; messageId?: string }
  | {
      ok: false;
      provider: EmailProviderName;
      error: string;
      statusCode?: number;
      detail?: string;
    };

export type EmailServiceStatus = {
  configured: boolean;
  provider: EmailProviderName;
  apiKeyConfigured: boolean;
  fromConfigured: boolean;
  fromEmail: string | null;
  fromName: string;
  usingTestingSender: boolean;
  canSendToAnyRecipient: boolean;
  missing: string[];
  setupHint: string;
  developmentEmailFallback: boolean;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

/** Local dev: log email and succeed when Resend/Brevo are not production-ready. */
export function isDevelopmentEmailFallbackEnabled() {
  const value = env("EMAIL_DEV_OTP_FALLBACK").toLowerCase();
  if (value === "0" || value === "false" || value === "off") {
    return false;
  }
  if (value === "1" || value === "true" || value === "on") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

/** Resend's shared testing domain — never delivers OTP to arbitrary recipients. */
export function isResendTestingSender(email: string) {
  return email.toLowerCase().endsWith("@resend.dev");
}

export function resolveTransactionalFromEmail() {
  return env("EMAIL_FROM") || env("RESEND_FROM_EMAIL") || env("BREVO_FROM_EMAIL");
}

export function resolveTransactionalFromName() {
  return env("EMAIL_FROM_NAME") || env("RESEND_FROM_NAME") || env("BREVO_FROM_NAME") || "CareerVault";
}

function resolveProvider(): EmailProviderName {
  const forced = env("EMAIL_PROVIDER").toLowerCase();
  const fromEmail = resolveTransactionalFromEmail();
  const resendReady =
    Boolean(env("RESEND_API_KEY") && fromEmail) && !isResendTestingSender(fromEmail);
  const brevoReady = Boolean(env("BREVO_API_KEY") && fromEmail);

  if (forced === "resend") {
    return resendReady ? "resend" : "none";
  }

  if (forced === "brevo") {
    return brevoReady ? "brevo" : "none";
  }

  // Production default: verified Resend domain first, then Brevo verified sender.
  if (resendReady) {
    return "resend";
  }

  if (brevoReady) {
    return "brevo";
  }

  return "none";
}

export function getRequestEmailStatus(): EmailServiceStatus {
  const fromEmail = resolveTransactionalFromEmail();
  const provider = resolveProvider();
  const usingTestingSender = Boolean(fromEmail && isResendTestingSender(fromEmail));
  const usingPlaceholderFrom =
    Boolean(fromEmail) &&
    (fromEmail.toLowerCase().includes("yourdomain.com") ||
      fromEmail.toLowerCase().includes("example.com") ||
      fromEmail.toLowerCase().includes("localhost"));
  const resendKeyConfigured = Boolean(env("RESEND_API_KEY"));
  const brevoKeyConfigured = Boolean(env("BREVO_API_KEY"));
  const configured = provider !== "none" && !usingPlaceholderFrom;

  const missing: string[] = [];
  if (!fromEmail || usingPlaceholderFrom) {
    missing.push("EMAIL_FROM on a verified domain (not yourdomain.com)");
  }
  if (usingTestingSender) {
    missing.push("Replace @resend.dev with a verified domain sender in EMAIL_FROM");
  }
  if (!resendKeyConfigured && !brevoKeyConfigured) {
    missing.push("RESEND_API_KEY or BREVO_API_KEY");
  }
  if (
    fromEmail &&
    !usingTestingSender &&
    !usingPlaceholderFrom &&
    resendKeyConfigured &&
    provider === "none"
  ) {
    missing.push("Valid RESEND_API_KEY with permission to send");
  }

  const setupHint = usingTestingSender
    ? "Verify a custom domain in Resend and set EMAIL_FROM to noreply@yourdomain.com. See docs/EMAIL_SETUP.md."
    : usingPlaceholderFrom
      ? "Replace EMAIL_FROM placeholder with a real address on your verified Resend/Brevo domain, and set RESEND_API_KEY (or BREVO_API_KEY)."
      : !configured
        ? "Set RESEND_API_KEY + EMAIL_FROM on a verified domain in careervault-hr/.env.local (and careervault/.env.local), then restart both apps. See docs/EMAIL_SETUP.md."
        : "Email delivery is configured for any recipient address.";

  return {
    configured,
    provider: configured ? provider : "none",
    apiKeyConfigured: resendKeyConfigured || brevoKeyConfigured,
    fromConfigured: Boolean(fromEmail) && !usingPlaceholderFrom,
    fromEmail: fromEmail || null,
    fromName: resolveTransactionalFromName(),
    usingTestingSender,
    canSendToAnyRecipient: configured,
    missing,
    setupHint: configured
      ? setupHint
      : isDevelopmentEmailFallbackEnabled()
        ? `${setupHint} Local development fallback is active for OTP only; document-request emails require live delivery.`
        : setupHint,
    developmentEmailFallback: !configured && isDevelopmentEmailFallbackEnabled(),
  };
}

export function getFriendlyEmailDeliveryMessage(error: string, detail = "") {
  const combined = `${error} ${detail}`.toLowerCase();
  const status = getRequestEmailStatus();

  if (
    combined.includes("missing") ||
    combined.includes("not configured") ||
    (!status.apiKeyConfigured && !status.configured)
  ) {
    return (
      status.setupHint ||
      "Set RESEND_API_KEY and EMAIL_FROM (verified domain) in careervault-hr/.env.local, then restart the HR Portal."
    );
  }

  if (
    status.fromEmail?.includes("yourdomain.com") ||
    status.fromEmail?.includes("example.com") ||
    combined.includes("yourdomain.com")
  ) {
    return "EMAIL_FROM is still a placeholder (yourdomain.com). Set it to an address on your verified Resend domain, add RESEND_API_KEY, then restart both apps.";
  }

  if (status.usingTestingSender || combined.includes("@resend.dev")) {
    return "Email is not configured for production delivery. Verify a custom domain in Resend and set EMAIL_FROM to an address on that domain (for example noreply@yourdomain.com).";
  }

  if (
    combined.includes("only send testing emails") ||
    combined.includes("verify a domain") ||
    combined.includes("testing email address")
  ) {
    return "The email provider rejected delivery because the sender domain is not verified. Complete domain verification in Resend and update EMAIL_FROM.";
  }

  if (combined.includes("invalid") && combined.includes("from")) {
    return "The configured sender email is invalid or unverified. Update EMAIL_FROM to a verified address on your domain.";
  }

  if (
    combined.includes("sender") &&
    (combined.includes("not verified") ||
      combined.includes("unrecognised") ||
      combined.includes("unrecognized"))
  ) {
    return "The sender address is not verified with your email provider. Verify EMAIL_FROM, then try again.";
  }

  if (error.trim()) {
    return error.trim();
  }

  return "We could not send the email right now. Please try again shortly or contact support if the issue continues.";
}

function senderIdentity() {
  const email = resolveTransactionalFromEmail();
  const name = resolveTransactionalFromName();
  return { email, name, formatted: email ? `${name} <${email}>` : "" };
}

export async function sendTransactionalEmail(
  to: string,
  content: RequestEmailContent,
  options: {
    idempotencyKey: string;
    /** When true, never treat local log-only fallback as a successful send. */
    requireLiveDelivery?: boolean;
  },
): Promise<EmailSendResult> {
  const normalizedTo = to.trim().toLowerCase();
  if (!normalizedTo) {
    return { ok: false, provider: "none", error: "Recipient email is required." };
  }

  const status = getRequestEmailStatus();
  const sender = senderIdentity();
  const requireLiveDelivery = options.requireLiveDelivery === true;

  if (!status.configured || !sender.email || status.usingTestingSender) {
    if (!requireLiveDelivery && isDevelopmentEmailFallbackEnabled()) {
      console.info("CareerVault development email (not sent via provider).", {
        to: normalizedTo,
        from: sender.email || "(unset)",
        subject: content.subject,
        textPreview: content.text.slice(0, 240),
      });
      return { ok: true, provider: "development", messageId: "dev-local" };
    }

    console.error("CareerVault email delivery blocked: provider not production-ready.", {
      missing: status.missing,
      provider: status.provider,
      fromEmail: status.fromEmail,
      to: normalizedTo,
      requireLiveDelivery,
    });
    return {
      ok: false,
      provider: "none",
      error:
        status.missing.length > 0
          ? `Email delivery is not configured. Missing: ${status.missing.join(", ")}.`
          : status.setupHint,
    };
  }

  if (
    status.fromEmail &&
    (status.fromEmail.includes("yourdomain.com") ||
      status.fromEmail.includes("example.com"))
  ) {
    return {
      ok: false,
      provider: "none",
      error:
        "EMAIL_FROM is still a placeholder. Set a real verified sender address and RESEND_API_KEY, then restart the apps.",
    };
  }

  const provider = resolveProvider();
  if (provider === "brevo") {
    return sendWithBrevo(normalizedTo, content, sender, options.idempotencyKey);
  }

  return sendWithResend(normalizedTo, content, sender, options.idempotencyKey);
}

async function sendWithBrevo(
  to: string,
  content: RequestEmailContent,
  sender: { email: string; name: string },
  idempotencyKey: string,
): Promise<EmailSendResult> {
  const apiKey = env("BREVO_API_KEY");
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          accept: "application/json",
          "X-Sib-Idempotency-Key": idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          sender: { email: sender.email, name: sender.name },
          to: [{ email: to }],
          subject: content.subject,
          htmlContent: content.html,
          textContent: content.text,
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as { messageId?: string };
        console.info("CareerVault email accepted by Brevo.", { to, messageId: result.messageId });
        return { ok: true, provider: "brevo", messageId: result.messageId };
      }

      const detail = await response.text();
      if (retryableStatuses.has(response.status) && attempt < 2) {
        await wait(1_000 * 2 ** attempt);
        continue;
      }

      console.error("CareerVault email failed via Brevo.", { status: response.status, detail, to });
      return {
        ok: false,
        provider: "brevo",
        error: `Brevo API returned ${response.status}: ${detail}`,
        statusCode: response.status,
        detail,
      };
    } catch (error) {
      if (attempt < 2) {
        await wait(1_000 * 2 ** attempt);
        continue;
      }
      return {
        ok: false,
        provider: "brevo",
        error: error instanceof Error ? error.message : "Brevo email delivery failed.",
      };
    }
  }

  return { ok: false, provider: "brevo", error: "Brevo email delivery failed." };
}

async function sendWithResend(
  to: string,
  content: RequestEmailContent,
  sender: { email: string; name: string; formatted: string },
  idempotencyKey: string,
): Promise<EmailSendResult> {
  const apiKey = env("RESEND_API_KEY");
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          accept: "application/json",
          "Idempotency-Key": idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: sender.formatted,
          to: [to],
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as { id?: string };
        console.info("CareerVault email accepted by Resend.", { to, messageId: result.id });
        return { ok: true, provider: "resend", messageId: result.id };
      }

      const detail = await response.text();
      if (retryableStatuses.has(response.status) && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter)
          ? Math.min(5_000, Math.max(500, retryAfter * 1_000))
          : 1_000 * 2 ** attempt;
        await wait(delayMs);
        continue;
      }

      console.error("CareerVault email failed via Resend.", { status: response.status, detail, to });
      return {
        ok: false,
        provider: "resend",
        error: `Resend API returned ${response.status}: ${detail}`,
        statusCode: response.status,
        detail,
      };
    } catch (error) {
      if (attempt < 2) {
        await wait(1_000 * 2 ** attempt);
        continue;
      }
      return {
        ok: false,
        provider: "resend",
        error: error instanceof Error ? error.message : "Resend email delivery failed.",
      };
    }
  }

  return { ok: false, provider: "resend", error: "Resend email delivery failed." };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
