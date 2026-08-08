import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { VaultDocument } from "@/lib/careervault-data";
import { ensureDatabaseSchema, query, withTransaction } from "@/lib/database";
import {
  buildPasswordResetEmailContent,
  buildSignupMagicLinkEmailContent,
  getFriendlyEmailDeliveryMessage,
  getRequestEmailStatus,
  isDevelopmentEmailFallbackEnabled,
  sendRequestEmail,
  type RequestEmailContent,
} from "@/lib/request-email";

const scrypt = promisify(scryptCallback);
const resetExpiryMs = 10 * 60 * 1000;
const resendCooldownMs = 60 * 1000;
const sessionExpiryMs = 7 * 24 * 60 * 60 * 1000;
const maxVerificationAttempts = 5;
const signupMagicLinkExpiryMs = 24 * 60 * 60 * 1000;
const signupPasswordWindowMs = 15 * 60 * 1000;
const maxOtpSendsPerHour = 5;
const otpSendWindowMs = 60 * 60 * 1000;

type UserRecord = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: AccountRole;
  first_name?: string | null;
  last_name?: string | null;
};

export type AccountRole = "employee" | "recruiter";

type PasswordResetRecord = {
  email: string;
  code_hash: string;
  salt: string;
  expires_at: Date;
  resend_available_at: Date;
  verified: boolean;
  attempts: number;
  send_count?: number;
  send_window_started_at?: Date | null;
};

type SignupVerificationRecord = {
  email: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  role: AccountRole;
  code_hash: string;
  salt: string;
  token_hash?: string | null;
  expires_at: Date;
  resend_available_at: Date;
  verified: boolean;
  attempts: number;
  used_at?: Date | null;
  password_setup_token_hash?: string | null;
  password_setup_expires_at?: Date | null;
  send_count?: number;
  send_window_started_at?: Date | null;
};

type EmailDeliveryResult =
  | {
      ok: true;
      mode: "brevo" | "resend" | "development";
      messageId?: string;
      accepted: string[];
      rejected: string[];
      developmentCode?: string;
      developmentVerifyUrl?: string;
    }
  | {
      ok: false;
      mode: "unconfigured" | "failed";
      message: string;
    };

type StoredDocumentRow = {
  id: string;
  company_name: string;
  employee_name: string;
  designation: string;
  joining_date: Date | string;
  relieving_date?: Date | string | null;
  document_type: VaultDocument["documentType"];
  salary_info?: string | null;
  file_name: string;
  file_size: string;
  uploaded_at: Date | string;
  status: VaultDocument["status"];
  description?: string | null;
  file_type: "PDF" | "DOC" | "DOCX" | "JPG" | "PNG";
  extracted_text?: string | null;
  extracted_at?: Date | string | null;
  employment_period?: string | null;
  salary_month?: string | null;
  original_file_name?: string | null;
  file_mime_type?: string | null;
  last_viewed?: Date | string | null;
};

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
  firstName: string;
  lastName: string;
};

export type StoredDocument = VaultDocument & {
  description?: string;
  fileType: "PDF" | "DOC" | "DOCX" | "JPG" | "PNG";
  lastViewed?: string;
  extractedText?: string;
  extractedAt?: string;
  employmentPeriod?: string;
  salaryMonth?: string;
  originalFileName?: string;
  fileUrl?: string;
  fileMimeType?: string;
};

export const sessionCookieName = "cv_session";

export const passwordResetConfig = {
  resendCooldownSeconds: resendCooldownMs / 1000,
  resetExpiryMinutes: resetExpiryMs / 1000 / 60,
};

export const signupVerificationConfig = {
  resendCooldownSeconds: resendCooldownMs / 1000,
  magicLinkExpiryHours: signupMagicLinkExpiryMs / 1000 / 60 / 60,
  passwordSetupExpiryMinutes: signupPasswordWindowMs / 1000 / 60,
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toEpochMs(value: Date | string | number) {
  if (typeof value === "number") {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

function isOtpSendRateLimited(
  sendCount: number | undefined,
  windowStartedAt: Date | string | null | undefined,
) {
  if (!windowStartedAt) {
    return false;
  }

  const windowStart = toEpochMs(windowStartedAt);
  if (Date.now() - windowStart >= otpSendWindowMs) {
    return false;
  }

  return (sendCount ?? 0) >= maxOtpSendsPerHour;
}

export function getPasswordPolicyMessage(password: string) {
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }

  if (!/\d/.test(password)) {
    return "Password must include at least one number.";
  }

  return "";
}

export function getEmailServiceStatus() {
  return getRequestEmailStatus();
}

export async function createAccount({
  email,
  password,
  role,
  firstName,
  lastName,
  name,
}: {
  email: string;
  password: string;
  role: AccountRole;
  firstName?: string;
  lastName?: string;
  name?: string;
}) {
  const normalizedEmail = normalizeEmail(email);
  const passwordMessage = getPasswordPolicyMessage(password);
  const accountRole = role;
  const resolvedFirstName = String(firstName || "").trim();
  const resolvedLastName = String(lastName || "").trim();
  const legacyName = String(name || "").trim();
  const profileFirstName =
    resolvedFirstName ||
    (legacyName ? legacyName.split(/\s+/)[0] : "") ||
    normalizedEmail.split("@")[0] ||
    normalizedEmail;
  const profileLastName =
    resolvedLastName ||
    (legacyName.includes(" ")
      ? legacyName.split(/\s+/).slice(1).join(" ")
      : "");

  if (!normalizedEmail) {
    return { ok: false, status: 400, message: "Please enter your email address." };
  }

  if (!resolvedFirstName && !legacyName) {
    return { ok: false, status: 400, message: "Please enter your first name." };
  }

  if (!resolvedLastName && !legacyName) {
    return { ok: false, status: 400, message: "Please enter your last name." };
  }

  if (accountRole !== "employee" && accountRole !== "recruiter") {
    return { ok: false, status: 400, message: "Please choose an account type." };
  }

  if (passwordMessage) {
    return { ok: false, status: 400, message: passwordMessage };
  }

  await ensureSchema();

  const existingUser = await query<UserRecord>("select id from users where email = $1", [
    normalizedEmail,
  ]);

  if (existingUser.rowCount) {
    return {
      ok: false,
      status: 409,
      message: "An account already exists with this email address. Please sign in.",
    };
  }

  const passwordHash = await hashPassword(password);
  await withTransaction(async (client) => {
    const created = await client.query<{ id: string }>(
      `insert into users (name, email, password_hash, role, first_name, last_name)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        profileFirstName,
        normalizedEmail,
        passwordHash,
        accountRole,
        profileFirstName,
        profileLastName,
      ],
    );

    if (accountRole === "recruiter") {
      await client.query(
        `insert into hr_users (id, name, email, password_hash, first_name, last_name)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (email) do update
         set name = excluded.name,
             first_name = excluded.first_name,
             last_name = excluded.last_name,
             password_hash = excluded.password_hash,
             updated_at = now()`,
        [
          created.rows[0].id,
          profileFirstName,
          normalizedEmail,
          passwordHash,
          profileFirstName,
          profileLastName,
        ],
      );
    }

    await client.query("delete from signup_verifications where email = $1", [
      normalizedEmail,
    ]);
  });

  return {
    ok: true,
    status: 201,
    message: "Account created successfully. Please log in to continue.",
  };
}

export async function startSignupVerification({
  firstName,
  lastName,
  name,
  email,
  role,
}: {
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  role: AccountRole;
}) {
  const normalizedEmail = normalizeEmail(email);
  const resolvedFirstName = String(firstName || "").trim();
  const resolvedLastName = String(lastName || "").trim();
  const resolvedName =
    [resolvedFirstName, resolvedLastName].filter(Boolean).join(" ").trim() ||
    String(name || "").trim();

  if (!resolvedFirstName || !resolvedLastName) {
    if (!resolvedName) {
      return { ok: false, status: 400, message: "Please enter your first and last name." };
    }
  }

  if (!resolvedFirstName && resolvedName) {
    // Backward-compatible single name field
  } else if (!resolvedFirstName || !resolvedLastName) {
    return { ok: false, status: 400, message: "Please enter your first and last name." };
  }

  const accountName =
    resolvedFirstName && resolvedLastName
      ? `${resolvedFirstName} ${resolvedLastName}`
      : resolvedName;

  if (!normalizedEmail) {
    return { ok: false, status: 400, message: "Please enter your email address." };
  }

  if (role !== "employee" && role !== "recruiter") {
    return { ok: false, status: 400, message: "Please choose an account type." };
  }

  await ensureSchema();

  const existingUser = await query<UserRecord>("select id from users where email = $1", [
    normalizedEmail,
  ]);

  if (existingUser.rowCount) {
    return {
      ok: false,
      status: 409,
      message: "An account already exists with this email address. Please sign in.",
    };
  }

  const existingVerification = await query<SignupVerificationRecord>(
    "select * from signup_verifications where email = $1",
    [normalizedEmail],
  );
  const current = existingVerification.rows[0];

  if (current && Date.now() < toEpochMs(current.resend_available_at)) {
    return {
      ok: false,
      status: 429,
      message: "Please wait before requesting another verification email.",
      resendAvailableAt: toEpochMs(current.resend_available_at),
      expiresAt: toEpochMs(current.expires_at),
    };
  }

  if (current && isOtpSendRateLimited(current.send_count, current.send_window_started_at)) {
    return {
      ok: false,
      status: 429,
      message:
        "Too many verification emails were requested for this email. Please try again in about an hour.",
    };
  }

  const magic = buildSignedMagicToken();
  const salt = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + signupMagicLinkExpiryMs;
  const resendAvailableAt = Date.now() + resendCooldownMs;
  const first = resolvedFirstName || accountName.split(" ")[0] || accountName;
  const last =
    resolvedLastName || accountName.split(" ").slice(1).join(" ") || accountName;

  await query(
    `insert into signup_verifications
      (email, name, first_name, last_name, role, code_hash, salt, token_hash, expires_at, resend_available_at,
       verified, attempts, used_at, password_setup_token_hash, password_setup_expires_at,
       send_count, send_window_started_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, 0, null, null, null, 1, now())
     on conflict (email) do update set
      name = excluded.name,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      role = excluded.role,
      code_hash = excluded.code_hash,
      salt = excluded.salt,
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      resend_available_at = excluded.resend_available_at,
      verified = false,
      attempts = 0,
      used_at = null,
      password_setup_token_hash = null,
      password_setup_expires_at = null,
      send_count = case
        when signup_verifications.send_window_started_at is null
          or signup_verifications.send_window_started_at < now() - interval '1 hour'
        then 1
        else signup_verifications.send_count + 1
      end,
      send_window_started_at = case
        when signup_verifications.send_window_started_at is null
          or signup_verifications.send_window_started_at < now() - interval '1 hour'
        then now()
        else signup_verifications.send_window_started_at
      end,
      updated_at = now()`,
    [
      normalizedEmail,
      accountName,
      first,
      last,
      role,
      magic.tokenHash,
      salt,
      magic.tokenHash,
      new Date(expiresAt),
      new Date(resendAvailableAt),
    ],
  );

  const verifyUrl = `${getAppUrl()}/verify-email?token=${encodeURIComponent(magic.signedToken)}`;
  const delivery = await sendSignupMagicLinkEmail(accountName, normalizedEmail, verifyUrl);

  if (!delivery.ok) {
    await query(
      `update signup_verifications
       set resend_available_at = now(), updated_at = now()
       where email = $1`,
      [normalizedEmail],
    );

    return {
      ok: false,
      status: 503,
      message: delivery.message,
      resendAvailableAt: Date.now(),
      expiresAt,
      deliveryMode: delivery.mode,
    };
  }

  return {
    ok: true,
    status: 200,
    message:
      delivery.mode === "development"
        ? "Development mode: open the verification link shown below to continue."
        : "Check your email for a CareerVault verification link.",
    resendAvailableAt,
    expiresAt,
    deliveryMode: delivery.mode,
    developmentVerifyUrl: delivery.developmentVerifyUrl,
  };
}

export async function resendSignupVerificationCode(email: string) {
  await ensureSchema();
  const normalizedEmail = normalizeEmail(email);
  const existing = await query<SignupVerificationRecord>(
    "select * from signup_verifications where email = $1",
    [normalizedEmail],
  );
  const verification = existing.rows[0];

  if (!verification) {
    return {
      ok: false,
      status: 404,
      message: "Please start signup again to request a verification email.",
    };
  }

  if (Date.now() < toEpochMs(verification.resend_available_at)) {
    return {
      ok: false,
      status: 429,
      message: "Please wait before requesting another verification email.",
      resendAvailableAt: toEpochMs(verification.resend_available_at),
      expiresAt: toEpochMs(verification.expires_at),
    };
  }

  return startSignupVerification({
    firstName: verification.first_name || undefined,
    lastName: verification.last_name || undefined,
    name: verification.name,
    email: normalizedEmail,
    role: verification.role,
  });
}

export async function verifySignupMagicLink(token: string) {
  await ensureSchema();
  const signedToken = String(token || "").trim();
  if (!signedToken) {
    return {
      ok: false,
      status: 400,
      reason: "invalid" as const,
      message: "Invalid verification link.",
    };
  }

  const rawToken = parseSignedMagicToken(signedToken);
  if (!rawToken) {
    return {
      ok: false,
      status: 400,
      reason: "invalid" as const,
      message: "Invalid verification link.",
    };
  }

  const tokenHash = hashToken(rawToken);
  const verificationResult = await query<SignupVerificationRecord>(
    `select * from signup_verifications
     where token_hash = $1 or code_hash = $1
     order by updated_at desc
     limit 1`,
    [tokenHash],
  );
  const verification = verificationResult.rows[0];

  if (!verification) {
    return {
      ok: false,
      status: 400,
      reason: "invalid" as const,
      message: "Invalid verification link.",
    };
  }

  if (verification.used_at) {
    if (
      verification.verified &&
      verification.password_setup_token_hash &&
      verification.password_setup_expires_at &&
      Date.now() <= toEpochMs(verification.password_setup_expires_at)
    ) {
      return {
        ok: false,
        status: 409,
        reason: "already_used" as const,
        message: "This email is already verified. Continue creating your password or sign in.",
        email: verification.email,
      };
    }

    return {
      ok: false,
      status: 409,
      reason: "already_used" as const,
      message: "This email is already verified. Please sign in.",
      email: verification.email,
    };
  }

  if (verification.verified) {
    return {
      ok: false,
      status: 409,
      reason: "already_used" as const,
      message: "This email is already verified. Please sign in.",
      email: verification.email,
    };
  }

  if (Date.now() > toEpochMs(verification.expires_at)) {
    return {
      ok: false,
      status: 410,
      reason: "expired" as const,
      message: "This verification link has expired. Request a new verification email.",
      email: verification.email,
    };
  }

  const setup = buildOpaqueToken();
  const passwordSetupExpiresAt = Date.now() + signupPasswordWindowMs;

  await query(
    `update signup_verifications
     set verified = true,
         used_at = now(),
         password_setup_token_hash = $2,
         password_setup_expires_at = $3,
         expires_at = $3,
         updated_at = now()
     where email = $1`,
    [verification.email, setup.tokenHash, new Date(passwordSetupExpiresAt)],
  );

  return {
    ok: true,
    status: 200,
    reason: "verified" as const,
    message: "Email verified. Please create your password.",
    email: verification.email,
    setupToken: setup.rawToken,
    expiresAt: passwordSetupExpiresAt,
  };
}

/** @deprecated OTP signup removed — use verifySignupMagicLink */
export async function verifySignupCode(_email: string, _code: string) {
  return {
    ok: false,
    status: 410,
    message: "OTP verification has been replaced. Please use the email verification link.",
  };
}

export async function authenticateUser(email: string, password: string) {
  await ensureSchema();
  const normalizedEmail = normalizeEmail(email);
  const result = await query<UserRecord>("select * from users where email = $1", [
    normalizedEmail,
  ]);
  const user = result.rows[0];

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return {
      ok: false,
      status: 401,
      message:
        "No account was found with the provided credentials. Please create an account to continue.",
    };
  }

  const session = await createSession(user.id);

  return {
    ok: true,
    status: 200,
    user: toPublicUser(user),
    session,
    message: "Signed in successfully.",
  };
}

export async function getSessionUser(sessionToken?: string) {
  if (!sessionToken) {
    return null;
  }

  await ensureSchema();
  const tokenHash = hashToken(sessionToken);
  const result = await query<UserRecord>(
    `select users.*
     from sessions
     join users on users.id = sessions.user_id
     where sessions.token_hash = $1 and sessions.expires_at > now()`,
    [tokenHash],
  );

  return result.rows[0] ? toPublicUser(result.rows[0]) : null;
}

export async function deleteSession(sessionToken?: string) {
  if (!sessionToken) {
    return;
  }

  await ensureSchema();
  await query("delete from sessions where token_hash = $1", [hashToken(sessionToken)]);
}

export async function requestPasswordReset(email: string) {
  await ensureSchema();
  const normalizedEmail = normalizeEmail(email);
  const userResult = await query<UserRecord>("select * from users where email = $1", [
    normalizedEmail,
  ]);
  const user = userResult.rows[0];

  if (!user) {
    return {
      ok: false,
      status: 404,
      message: "No account was found with this email address.",
    };
  }

  const existingReset = await query<PasswordResetRecord>(
    "select * from password_resets where email = $1",
    [normalizedEmail],
  );
  const currentReset = existingReset.rows[0];

  if (
    currentReset &&
    isOtpSendRateLimited(currentReset.send_count, currentReset.send_window_started_at)
  ) {
    return {
      ok: false,
      status: 429,
      message: "Too many verification codes were requested for this email. Please try again in about an hour.",
    };
  }

  const reset = buildVerificationCode(normalizedEmail);
  await query(
    `insert into password_resets
      (email, code_hash, salt, expires_at, resend_available_at, verified, attempts, send_count, send_window_started_at)
     values ($1, $2, $3, $4, $5, false, 0, 1, now())
     on conflict (email) do update set
      code_hash = excluded.code_hash,
      salt = excluded.salt,
      expires_at = excluded.expires_at,
      resend_available_at = excluded.resend_available_at,
      verified = false,
      attempts = 0,
      send_count = case
        when password_resets.send_window_started_at is null
          or password_resets.send_window_started_at < now() - interval '1 hour'
        then 1
        else password_resets.send_count + 1
      end,
      send_window_started_at = case
        when password_resets.send_window_started_at is null
          or password_resets.send_window_started_at < now() - interval '1 hour'
        then now()
        else password_resets.send_window_started_at
      end,
      updated_at = now()`,
    [
      reset.record.email,
      reset.record.codeHash,
      reset.record.salt,
      new Date(reset.record.expiresAt),
      new Date(reset.record.resendAvailableAt),
    ],
  );
  const delivery = await sendPasswordResetEmail(user, reset.code);

  if (!delivery.ok) {
    return {
      ok: false,
      status: 503,
      message: delivery.message,
      resendAvailableAt: reset.record.resendAvailableAt,
      deliveryMode: delivery.mode,
    };
  }

  return {
    ok: true,
    status: 200,
    message:
      delivery.mode === "development"
        ? "Development mode: use the verification code shown in the app or terminal."
        : "A 6-digit verification code has been sent to your registered email.",
    resendAvailableAt: reset.record.resendAvailableAt,
    deliveryMode: delivery.mode,
    developmentCode: delivery.developmentCode,
  };
}

export async function resendPasswordResetCode(email: string) {
  await ensureSchema();
  const normalizedEmail = normalizeEmail(email);
  const existingReset = await query<PasswordResetRecord>(
    "select * from password_resets where email = $1",
    [normalizedEmail],
  );
  const reset = existingReset.rows[0];

  if (reset && Date.now() < toEpochMs(reset.resend_available_at)) {
    return {
      ok: false,
      status: 429,
      message: "Please wait before requesting another verification code.",
      resendAvailableAt: toEpochMs(reset.resend_available_at),
    };
  }

  return requestPasswordReset(normalizedEmail);
}

export async function verifyPasswordResetCode(email: string, code: string) {
  await ensureSchema();
  const normalizedEmail = normalizeEmail(email);
  const resetResult = await query<PasswordResetRecord>(
    "select * from password_resets where email = $1",
    [normalizedEmail],
  );
  const reset = resetResult.rows[0];

  if (!reset) {
    return {
      ok: false,
      status: 404,
      message: "Please request a new verification code.",
    };
  }

  if (Date.now() > toEpochMs(reset.expires_at)) {
    await query("delete from password_resets where email = $1", [normalizedEmail]);
    return {
      ok: false,
      status: 410,
      message: "This verification code has expired. Please request a new code.",
    };
  }

  if (reset.attempts >= maxVerificationAttempts) {
    await query("delete from password_resets where email = $1", [normalizedEmail]);
    return {
      ok: false,
      status: 429,
      message: "Too many incorrect attempts. Please request a new verification code.",
    };
  }

  if (!verifySecret(code, reset.salt, reset.code_hash)) {
    await query(
      "update password_resets set attempts = attempts + 1, updated_at = now() where email = $1",
      [normalizedEmail],
    );
    return {
      ok: false,
      status: 400,
      message: "The verification code is incorrect. Please check the code and try again.",
    };
  }

  await query(
    "update password_resets set verified = true, updated_at = now() where email = $1",
    [normalizedEmail],
  );

  return {
    ok: true,
    status: 200,
    message: "Code verified. Please create a new password.",
  };
}

export async function resetPassword({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  await ensureSchema();
  const normalizedEmail = normalizeEmail(email);
  const passwordMessage = getPasswordPolicyMessage(password);

  if (passwordMessage) {
    return { ok: false, status: 400, message: passwordMessage };
  }

  const resetResult = await query<PasswordResetRecord>(
    "select * from password_resets where email = $1",
    [normalizedEmail],
  );
  const reset = resetResult.rows[0];

  if (!reset?.verified) {
    return {
      ok: false,
      status: 403,
      message: "Please verify your email before resetting your password.",
    };
  }

  if (Date.now() > toEpochMs(reset.expires_at)) {
    await query("delete from password_resets where email = $1", [normalizedEmail]);
    return {
      ok: false,
      status: 410,
      message: "This verification code has expired. Please request a new code.",
    };
  }

  await query("update users set password_hash = $1, updated_at = now() where email = $2", [
    await hashPassword(password),
    normalizedEmail,
  ]);
  await query("delete from password_resets where email = $1", [normalizedEmail]);

  return {
    ok: true,
    status: 200,
    message: "Your password has been reset successfully. Please sign in with your new password.",
  };
}

export async function listDocuments(userId: string) {
  await ensureSchema();
  const result = await query<StoredDocumentRow>(
    "select * from documents where user_id = $1 order by uploaded_at desc",
    [userId],
  );
  return result.rows.map(toStoredDocument);
}

export async function createDocument(
  user: PublicUser,
  document: Omit<StoredDocument, "id" | "uploadedAt" | "fileUrl">,
  file: {
    data: Buffer;
    mimeType: string;
  },
) {
  await ensureSchema();
  const result = await query<StoredDocumentRow>(
    `insert into documents
      (user_id, company_name, employee_name, designation, joining_date, relieving_date,
       document_type, salary_info, file_name, file_size, status, description, file_type,
       extracted_text, extracted_at, employment_period, salary_month, original_file_name,
       file_mime_type, file_data)
     values
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     returning *`,
    [
      user.id,
      document.companyName,
      document.employeeName,
      document.designation,
      document.joiningDate,
      document.relievingDate || null,
      document.documentType,
      document.salaryInfo || null,
      document.fileName,
      document.fileSize,
      document.status,
      document.description || null,
      document.fileType,
      document.extractedText || null,
      document.extractedAt || null,
      document.employmentPeriod || null,
      document.salaryMonth || null,
      document.originalFileName || null,
      file.mimeType,
      file.data.toString("base64"),
    ],
  );
  return toStoredDocument(result.rows[0]);
}

export async function updateDocument(userId: string, document: StoredDocument) {
  await ensureSchema();
  const result = await query<StoredDocumentRow>(
    `update documents set
      company_name = $1,
      employee_name = $2,
      designation = $3,
      joining_date = $4,
      relieving_date = $5,
      document_type = $6,
      salary_info = $7,
      file_name = $8,
      status = $9,
      description = $10,
      extracted_text = $11,
      employment_period = $12,
      salary_month = $13,
      updated_at = now()
     where id = $14 and user_id = $15
     returning *`,
    [
      document.companyName,
      document.employeeName,
      document.designation,
      document.joiningDate,
      document.relievingDate || null,
      document.documentType,
      document.salaryInfo || null,
      document.fileName,
      document.status,
      document.description || null,
      document.extractedText || null,
      document.employmentPeriod || null,
      document.salaryMonth || null,
      document.id,
      userId,
    ],
  );
  return result.rows[0] ? toStoredDocument(result.rows[0]) : null;
}

export async function deleteDocument(userId: string, documentId: string) {
  await ensureSchema();
  const submittedReference = await query<{ exists: boolean }>(
    `select exists (
       select 1
       from document_request_items request_items
       join document_requests requests on requests.id = request_items.request_id
       where request_items.submitted_document_id = $1
         and requests.status = 'submitted'
     )`,
    [documentId],
  );

  if (submittedReference.rows[0]?.exists) {
    return "referenced" as const;
  }

  const result = await query("delete from documents where id = $1 and user_id = $2", [
    documentId,
    userId,
  ]);
  return (result.rowCount || 0) > 0 ? ("deleted" as const) : ("not_found" as const);
}

export async function markDocumentViewed(userId: string, documentId: string) {
  await ensureSchema();
  const result = await query<StoredDocumentRow>(
    `update documents set last_viewed = current_date, updated_at = now()
     where id = $1 and user_id = $2
     returning *`,
    [documentId, userId],
  );
  return result.rows[0] ? toStoredDocument(result.rows[0]) : null;
}

export async function getDocumentFile(userId: string, documentId: string) {
  await ensureSchema();
  const result = await query<{
    file_data: string;
    file_mime_type: string;
    original_file_name: string | null;
    file_name: string;
  }>(
    `select file_data, file_mime_type, original_file_name, file_name
     from documents
     where id = $1 and user_id = $2`,
    [documentId, userId],
  );
  const file = result.rows[0];

  return file
    ? {
        data: Buffer.from(file.file_data, "base64"),
        mimeType: file.file_mime_type || "application/octet-stream",
        fileName: file.original_file_name || file.file_name,
      }
    : null;
}

async function ensureSchema() {
  return ensureDatabaseSchema();
}

async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + sessionExpiryMs;

  await query(
    "insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)",
    [hashToken(token), userId, new Date(expiresAt)],
  );

  return {
    token,
    expiresAt,
  };
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");

  if (!salt || !hash) {
    return false;
  }

  const storedBuffer = Buffer.from(hash, "hex");
  const derivedBuffer = (await scrypt(password, salt, storedBuffer.length)) as Buffer;

  return (
    storedBuffer.length === derivedBuffer.length &&
    timingSafeEqual(storedBuffer, derivedBuffer)
  );
}

function buildVerificationCode(email: string) {
  const now = Date.now();
  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(16).toString("hex");

  return {
    code,
    record: {
      email,
      salt,
      codeHash: hashSecret(code, salt),
      expiresAt: now + resetExpiryMs,
      resendAvailableAt: now + resendCooldownMs,
    },
  };
}

function hashSecret(value: string, salt: string) {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function verifySecret(value: string, salt: string, hash: string) {
  const expected = Buffer.from(hashSecret(value, salt), "hex");
  const actual = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

async function sendSignupMagicLinkEmail(
  userName: string,
  email: string,
  verifyUrl: string,
): Promise<EmailDeliveryResult> {
  return deliverAuthOtpEmail({
    to: email,
    code: "",
    developmentVerifyUrl: verifyUrl,
    content: buildSignupMagicLinkEmailContent(
      userName,
      verifyUrl,
      signupVerificationConfig.magicLinkExpiryHours,
    ),
    idempotencyKey: `signup-magic/${email}/${createHash("sha256").update(verifyUrl).digest("hex")}`,
    unconfiguredMessage: "Email service is not configured for production delivery.",
    failureLogLabel: "signup magic link",
  });
}

async function sendPasswordResetEmail(
  user: UserRecord,
  code: string,
): Promise<EmailDeliveryResult> {
  return deliverAuthOtpEmail({
    to: user.email,
    code,
    content: buildPasswordResetEmailContent(
      user.name,
      code,
      passwordResetConfig.resetExpiryMinutes,
      getAppUrl(),
    ),
    idempotencyKey: `password-reset/${user.id}/${createHash("sha256").update(code).digest("hex")}`,
    unconfiguredMessage:
      "Email service is not configured for production delivery.",
    failureLogLabel: "password reset",
  });
}

async function deliverAuthOtpEmail({
  to,
  code,
  content,
  idempotencyKey,
  unconfiguredMessage,
  failureLogLabel,
  developmentVerifyUrl,
}: {
  to: string;
  code: string;
  content: RequestEmailContent;
  idempotencyKey: string;
  unconfiguredMessage: string;
  failureLogLabel: string;
  developmentVerifyUrl?: string;
}): Promise<EmailDeliveryResult> {
  const status = getEmailServiceStatus();

  if (!status.configured) {
    if (isDevelopmentOtpFallbackEnabled()) {
      console.info(`CareerVault ${failureLogLabel} generated via development fallback.`, {
        to,
        code: code || undefined,
        verifyUrl: developmentVerifyUrl,
      });
      return {
        ok: true,
        mode: "development",
        accepted: [to],
        rejected: [],
        developmentCode: code || undefined,
        developmentVerifyUrl,
      };
    }

    console.error("CareerVault email delivery skipped: email provider is not fully configured.", {
      missing: status.missing,
      provider: status.provider,
      usingTestingSender: status.usingTestingSender,
      canSendToAnyRecipient: status.canSendToAnyRecipient,
    });
    return {
      ok: false,
      mode: "unconfigured",
      message:
        status.missing.length > 0
          ? `${unconfiguredMessage} ${status.setupHint}`
          : status.setupHint || unconfiguredMessage,
    };
  }

  const result = await sendRequestEmail(to, content, { idempotencyKey });
  if (result.ok) {
    return {
      ok: true,
      mode: result.provider === "development" ? "development" : result.provider,
      messageId: result.messageId,
      accepted: [to],
      rejected: [],
      developmentVerifyUrl:
        result.provider === "development" ? developmentVerifyUrl : undefined,
    };
  }

  console.error(`CareerVault ${failureLogLabel} email failed via ${result.provider}.`, {
    to,
    error: result.error,
  });
  return {
    ok: false,
    mode: "failed",
    message: getFriendlyEmailDeliveryMessage(result.error, result.detail || ""),
  };
}

function isDevelopmentOtpFallbackEnabled() {
  return isDevelopmentEmailFallbackEnabled();
}

function getAuthTokenSecret() {
  return (
    process.env.AUTH_TOKEN_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "careervault-dev-auth-secret"
  );
}

function buildOpaqueToken() {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
  };
}

function buildSignedMagicToken() {
  const opaque = buildOpaqueToken();
  const signature = createHmac("sha256", getAuthTokenSecret())
    .update(opaque.rawToken)
    .digest("base64url");
  return {
    signedToken: `${opaque.rawToken}.${signature}`,
    tokenHash: opaque.tokenHash,
  };
}

function parseSignedMagicToken(token: string) {
  const [rawToken, signature] = token.split(".");
  if (!rawToken || !signature) {
    return null;
  }

  const expected = createHmac("sha256", getAuthTokenSecret())
    .update(rawToken)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  return rawToken;
}

function timingSafeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function toPublicUser(user: UserRecord): PublicUser {
  const firstName =
    String(user.first_name || "").trim() ||
    String(user.name || "").trim().split(/\s+/)[0] ||
    "";
  const lastName = String(user.last_name || "").trim();

  return {
    id: user.id,
    name: firstName || user.name,
    email: user.email,
    role: user.role,
    firstName: firstName || user.name,
    lastName,
  };
}

function toStoredDocument(row: StoredDocumentRow): StoredDocument {
  return {
    id: row.id,
    companyName: row.company_name,
    employeeName: row.employee_name,
    designation: row.designation,
    joiningDate: toDateOnly(row.joining_date),
    relievingDate: row.relieving_date ? toDateOnly(row.relieving_date) : undefined,
    documentType: row.document_type,
    salaryInfo: row.salary_info || undefined,
    fileName: row.file_name,
    fileSize: row.file_size,
    uploadedAt: toDateOnly(row.uploaded_at),
    status: row.status,
    description: row.description || undefined,
    fileType: row.file_type,
    extractedText: row.extracted_text || undefined,
    extractedAt: row.extracted_at ? toDateOnly(row.extracted_at) : undefined,
    employmentPeriod: row.employment_period || undefined,
    salaryMonth: row.salary_month || undefined,
    originalFileName: row.original_file_name || undefined,
    fileMimeType: row.file_mime_type || undefined,
    lastViewed: row.last_viewed ? toDateOnly(row.last_viewed) : undefined,
    fileUrl: `/api/documents/${row.id}/file`,
  };
}

function toDateOnly(value: Date | string) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
