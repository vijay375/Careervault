import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import nodemailer from "nodemailer";

const scrypt = promisify(scryptCallback);
const dataDir =
  process.env.VERCEL === "1"
    ? path.join(tmpdir(), "careervault")
    : path.join(process.cwd(), ".data");
const databasePath = path.join(dataDir, "careervault-auth.json");
const resetExpiryMs = 10 * 60 * 1000;
const resendCooldownMs = 60 * 1000;
const maxVerificationAttempts = 5;

type UserRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

type PasswordResetRecord = {
  email: string;
  codeHash: string;
  salt: string;
  expiresAt: number;
  resendAvailableAt: number;
  verified: boolean;
  attempts: number;
  updatedAt: string;
};

type AuthDatabase = {
  users: UserRecord[];
  passwordResets: PasswordResetRecord[];
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

const emptyDatabase: AuthDatabase = {
  users: [],
  passwordResets: [],
};

export type PublicUser = {
  name: string;
  email: string;
};

export const passwordResetConfig = {
  resendCooldownSeconds: resendCooldownMs / 1000,
  resetExpiryMinutes: resetExpiryMs / 1000 / 60,
};

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

export function getResetStatus(email: string) {
  return withDatabase(async (database) => {
    const reset = database.passwordResets.find(
      (item) => item.email === normalizeEmail(email),
    );

    return reset
      ? {
          email: reset.email,
          resendAvailableAt: reset.resendAvailableAt,
        }
      : null;
  });
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

  return withDatabase(async (database) => {
    const existingUser = database.users.find((user) => user.email === normalizedEmail);

    if (existingUser) {
      return {
        ok: false,
        status: 409,
        message: "An account already exists with this email address. Please sign in.",
      };
    }

    const now = new Date().toISOString();
    database.users.push({
      id: randomBytes(16).toString("hex"),
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      status: 201,
      message: "Account created successfully. Please sign in with your new credentials.",
    };
  });
}

export async function authenticateUser(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const database = await readDatabase();
  const user = database.users.find((item) => item.email === normalizedEmail);

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return {
      ok: false,
      status: 401,
      message:
        "No account was found with the provided credentials. Please create an account to continue.",
    };
  }

  return {
    ok: true,
    status: 200,
    user: toPublicUser(user),
    message: "Signed in successfully.",
  };
}

export async function requestPasswordReset(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const database = await readDatabase();
  const user = database.users.find((item) => item.email === normalizedEmail);

  if (!user) {
    return {
      ok: false,
      status: 404,
      message: "No account was found with this email address.",
    };
  }

  const reset = await buildPasswordReset(normalizedEmail);
  await writeDatabase({
    ...database,
    passwordResets: [
      ...database.passwordResets.filter((item) => item.email !== normalizedEmail),
      reset.record,
    ],
  });
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
  const normalizedEmail = normalizeEmail(email);
  const database = await readDatabase();
  const existingReset = database.passwordResets.find(
    (item) => item.email === normalizedEmail,
  );

  if (existingReset && Date.now() < existingReset.resendAvailableAt) {
    return {
      ok: false,
      status: 429,
      message: "Please wait before requesting another verification code.",
      resendAvailableAt: existingReset.resendAvailableAt,
    };
  }

  return requestPasswordReset(normalizedEmail);
}

export async function verifyPasswordResetCode(email: string, code: string) {
  const normalizedEmail = normalizeEmail(email);

  return withDatabase(async (database) => {
    const reset = database.passwordResets.find((item) => item.email === normalizedEmail);

    if (!reset) {
      return {
        ok: false,
        status: 404,
        message: "Please request a new verification code.",
      };
    }

    if (Date.now() > reset.expiresAt) {
      database.passwordResets = database.passwordResets.filter(
        (item) => item.email !== normalizedEmail,
      );
      return {
        ok: false,
        status: 410,
        message: "This verification code has expired. Please request a new code.",
      };
    }

    if (reset.attempts >= maxVerificationAttempts) {
      database.passwordResets = database.passwordResets.filter(
        (item) => item.email !== normalizedEmail,
      );
      return {
        ok: false,
        status: 429,
        message: "Too many incorrect attempts. Please request a new verification code.",
      };
    }

    if (!verifySecret(code, reset.salt, reset.codeHash)) {
      reset.attempts += 1;
      reset.updatedAt = new Date().toISOString();
      return {
        ok: false,
        status: 400,
        message: "The verification code is incorrect. Please check the code and try again.",
      };
    }

    reset.verified = true;
    reset.updatedAt = new Date().toISOString();

    return {
      ok: true,
      status: 200,
      message: "Code verified. Please create a new password.",
    };
  });
}

export async function resetPassword({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  const normalizedEmail = normalizeEmail(email);
  const passwordMessage = getPasswordPolicyMessage(password);

  if (passwordMessage) {
    return { ok: false, status: 400, message: passwordMessage };
  }

  return withDatabase(async (database) => {
    const user = database.users.find((item) => item.email === normalizedEmail);
    const reset = database.passwordResets.find((item) => item.email === normalizedEmail);

    if (!user || !reset?.verified) {
      return {
        ok: false,
        status: 403,
        message: "Please verify your email before resetting your password.",
      };
    }

    if (Date.now() > reset.expiresAt) {
      database.passwordResets = database.passwordResets.filter(
        (item) => item.email !== normalizedEmail,
      );
      return {
        ok: false,
        status: 410,
        message: "This verification code has expired. Please request a new code.",
      };
    }

    user.passwordHash = await hashPassword(password);
    user.updatedAt = new Date().toISOString();
    database.passwordResets = database.passwordResets.filter(
      (item) => item.email !== normalizedEmail,
    );

    return {
      ok: true,
      status: 200,
      message:
        "Your password has been reset successfully. Please sign in with your new password.",
    };
  });
}

async function withDatabase<T>(callback: (database: AuthDatabase) => Promise<T> | T) {
  const database = await readDatabase();
  const result = await callback(database);
  await writeDatabase(database);
  return result;
}

async function readDatabase(): Promise<AuthDatabase> {
  try {
    const rawDatabase = await readFile(databasePath, "utf8");
    return JSON.parse(rawDatabase) as AuthDatabase;
  } catch {
    return { ...emptyDatabase, users: [], passwordResets: [] };
  }
}

async function writeDatabase(database: AuthDatabase) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(databasePath, JSON.stringify(database, null, 2));
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

async function buildPasswordReset(email: string) {
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
      verified: false,
      attempts: 0,
      updatedAt: new Date().toISOString(),
    },
  };
}

function hashSecret(value: string, salt: string) {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
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
    name: user.name,
    email: user.email,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
