import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import nodemailer from "nodemailer";
import { Pool } from "pg";
import type { QueryResultRow } from "pg";
import type { VaultDocument } from "@/lib/careervault-data";

const scrypt = promisify(scryptCallback);
const resetExpiryMs = 10 * 60 * 1000;
const resendCooldownMs = 60 * 1000;
const sessionExpiryMs = 7 * 24 * 60 * 60 * 1000;
const maxVerificationAttempts = 5;
const databaseUrl = process.env.DATABASE_URL;

let schemaReady: Promise<void> | null = null;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
    })
  : null;

type UserRecord = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
};

type PasswordResetRecord = {
  email: string;
  code_hash: string;
  salt: string;
  expires_at: Date;
  resend_available_at: Date;
  verified: boolean;
  attempts: number;
};

type EmailDeliveryResult =
  | {
      ok: true;
      mode: "smtp";
      messageId?: string;
      accepted: string[];
      rejected: string[];
    }
  | {
      ok: false;
      mode: "unconfigured";
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

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
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
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const userName = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  const missing = [
    ["SMTP_HOST", host],
    ["SMTP_PORT", port],
    ["SMTP_USER", userName],
    ["SMTP_PASSWORD", password],
    ["SMTP_FROM", from],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    configured: missing.length === 0,
    provider: "smtp",
    hostConfigured: Boolean(host),
    port: port ? Number(port) : null,
    userConfigured: Boolean(userName),
    passwordConfigured: Boolean(password),
    fromConfigured: Boolean(from),
    missing,
  };
}

export async function createAccount({
  name,
  email,
  password,
}: {
  name: string;
  email: string;
  password: string;
}) {
  const normalizedEmail = normalizeEmail(email);
  const passwordMessage = getPasswordPolicyMessage(password);

  if (!name.trim()) {
    return { ok: false, status: 400, message: "Please enter your full name." };
  }

  if (!normalizedEmail) {
    return { ok: false, status: 400, message: "Please enter your email address." };
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

  await query(
    `insert into users (name, email, password_hash)
     values ($1, $2, $3)`,
    [name.trim(), normalizedEmail, await hashPassword(password)],
  );

  return {
    ok: true,
    status: 201,
    message: "Account created successfully. Please sign in with your new credentials.",
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

  const reset = buildPasswordReset(normalizedEmail);
  await query(
    `insert into password_resets
      (email, code_hash, salt, expires_at, resend_available_at, verified, attempts)
     values ($1, $2, $3, $4, $5, false, 0)
     on conflict (email) do update set
      code_hash = excluded.code_hash,
      salt = excluded.salt,
      expires_at = excluded.expires_at,
      resend_available_at = excluded.resend_available_at,
      verified = false,
      attempts = 0,
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
    message: "A 6-digit verification code has been sent to your registered email.",
    resendAvailableAt: reset.record.resendAvailableAt,
    deliveryMode: delivery.mode,
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

  if (reset && Date.now() < reset.resend_available_at.getTime()) {
    return {
      ok: false,
      status: 429,
      message: "Please wait before requesting another verification code.",
      resendAvailableAt: reset.resend_available_at.getTime(),
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

  if (Date.now() > reset.expires_at.getTime()) {
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

  if (Date.now() > reset.expires_at.getTime()) {
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
  await query("delete from documents where id = $1 and user_id = $2", [documentId, userId]);
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
  if (!schemaReady) {
    schemaReady = createSchema();
  }

  return schemaReady;
}

async function createSchema() {
  await query("create extension if not exists pgcrypto");
  await query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      email text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists sessions (
      token_hash text primary key,
      user_id uuid not null references users(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists password_resets (
      email text primary key,
      code_hash text not null,
      salt text not null,
      expires_at timestamptz not null,
      resend_available_at timestamptz not null,
      verified boolean not null default false,
      attempts integer not null default 0,
      updated_at timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists documents (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      company_name text not null,
      employee_name text not null,
      designation text not null,
      joining_date date not null,
      relieving_date date,
      document_type text not null,
      salary_info text,
      file_name text not null,
      file_size text not null,
      uploaded_at timestamptz not null default now(),
      status text not null,
      description text,
      file_type text not null,
      extracted_text text,
      extracted_at date,
      employment_period text,
      salary_month text,
      original_file_name text,
      file_mime_type text,
      file_data text not null,
      last_viewed date,
      updated_at timestamptz not null default now()
    )
  `);
}

async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return pool.query<T>(sql, values);
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

function buildPasswordReset(email: string) {
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

async function sendPasswordResetEmail(
  user: UserRecord,
  code: string,
): Promise<EmailDeliveryResult> {
  const status = getEmailServiceStatus();
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const userName = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || "CareerVault <no-reply@careervault.local>";

  if (!status.configured || !host || !userName || !password) {
    return {
      ok: false,
      mode: "unconfigured",
      message:
        "Email service is not configured. Please configure SMTP environment variables before requesting a reset code.",
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user: userName,
      pass: password,
    },
  });

  await transporter.verify();

  const result = await transporter.sendMail({
    from,
    to: user.email,
    subject: "Your CareerVault password reset code",
    text: `Hello ${user.name},\n\nYour CareerVault verification code is ${code}. It expires in ${passwordResetConfig.resetExpiryMinutes} minutes.\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hello ${escapeHtml(user.name)},</p><p>Your CareerVault verification code is <strong>${code}</strong>.</p><p>It expires in ${passwordResetConfig.resetExpiryMinutes} minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
  });

  return {
    ok: true,
    mode: "smtp",
    messageId: result.messageId,
    accepted: result.accepted.map(String),
    rejected: result.rejected.map(String),
  };
}

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
