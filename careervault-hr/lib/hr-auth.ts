import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { ensureDatabaseSchema, query, withTransaction } from "@/lib/database";
import { ensureRequestSchema } from "@/lib/document-requests";

const scrypt = promisify(scryptCallback);
const sessionExpiryMs = 7 * 24 * 60 * 60 * 1000;

export type HrUser = {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  first_name?: string | null;
  last_name?: string | null;
};

export const hrSessionCookieName = "cv_session";

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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toHrUser(user: Pick<UserRow, "id" | "name" | "email" | "first_name" | "last_name">): HrUser {
  const firstName =
    String(user.first_name || "").trim() ||
    String(user.name || "").trim().split(/\s+/)[0] ||
    "";
  const lastName = String(user.last_name || "").trim();

  return {
    id: user.id,
    name: firstName || user.name,
    email: user.email,
    firstName: firstName || user.name,
    lastName,
  };
}

export async function createHrAccount({
  firstName,
  lastName,
  name,
  email,
  password,
}: {
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  password: string;
}) {
  const normalizedEmail = normalizeEmail(email);
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
  const passwordMessage = getPasswordPolicyMessage(password);

  if (!normalizedEmail) {
    return { ok: false as const, status: 400, message: "Please enter your email address." };
  }

  if (!resolvedFirstName && !legacyName) {
    return { ok: false as const, status: 400, message: "Please enter your first name." };
  }

  if (!resolvedLastName && !legacyName) {
    return { ok: false as const, status: 400, message: "Please enter your last name." };
  }

  if (passwordMessage) {
    return { ok: false as const, status: 400, message: passwordMessage };
  }

  await ensureDatabaseSchema();
  await ensureRequestSchema();

  const existing = await query<{ id: string }>("select id from users where email = $1", [
    normalizedEmail,
  ]);
  if (existing.rowCount) {
    return {
      ok: false as const,
      status: 409,
      message: "An account already exists with this email address. Please sign in.",
    };
  }

  const passwordHash = await hashPassword(password);
  await withTransaction(async (client) => {
    const created = await client.query<{ id: string }>(
      `insert into users (name, email, password_hash, role, first_name, last_name)
       values ($1, $2, $3, 'recruiter', $4, $5)
       returning id`,
      [profileFirstName, normalizedEmail, passwordHash, profileFirstName, profileLastName],
    );
    await client.query(
      `insert into hr_users (id, name, email, password_hash, first_name, last_name)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (email) do update
       set id = excluded.id,
           name = excluded.name,
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
  });

  return {
    ok: true as const,
    status: 201,
    message: "Account created successfully. Please log in to continue.",
  };
}

export async function authenticateHrUser(email: string, password: string) {
  await ensureDatabaseSchema();
  await ensureRequestSchema();

  const normalizedEmail = normalizeEmail(email);
  const result = await query<UserRow>("select * from users where email = $1", [
    normalizedEmail,
  ]);
  const user = result.rows[0];

  if (
    !user ||
    user.role !== "recruiter" ||
    !(await verifyPassword(password, user.password_hash))
  ) {
    return {
      ok: false as const,
      status: 401,
      message:
        "No recruiter account was found with the provided credentials. Please create an HR account to continue.",
    };
  }

  await ensureHrUserRow(user);
  const session = await createSession(user.id);
  const publicUser = toHrUser(user);

  return {
    ok: true as const,
    status: 200,
    message: "Signed in successfully.",
    user: publicUser,
    session,
  };
}

export async function getHrSessionUser(sessionToken?: string) {
  if (!sessionToken) {
    return null;
  }

  await ensureRequestSchema();
  const result = await query<UserRow>(
    `select coalesce(hr_users.id, users.id) as id,
            users.name,
            users.email,
            users.password_hash,
            users.role,
            coalesce(users.first_name, hr_users.first_name) as first_name,
            coalesce(users.last_name, hr_users.last_name) as last_name
     from sessions
     join users on users.id = sessions.user_id
     left join hr_users on lower(hr_users.email) = lower(users.email)
     where sessions.token_hash = $1
       and sessions.expires_at > now()
       and users.role = 'recruiter'`,
    [hashToken(sessionToken)],
  );

  const user = result.rows[0] || null;
  if (!user) {
    return null;
  }

  await ensureHrUserRow(user);
  return toHrUser(user);
}

export async function deleteHrSession(sessionToken?: string) {
  if (!sessionToken) {
    return;
  }

  await ensureRequestSchema();
  await query("delete from sessions where token_hash = $1", [hashToken(sessionToken)]);
}

async function ensureHrUserRow(user: UserRow) {
  const firstName =
    String(user.first_name || "").trim() ||
    String(user.name || "").trim().split(/\s+/)[0] ||
    user.name;
  const lastName = String(user.last_name || "").trim();

  await query(
    `insert into hr_users (id, name, email, password_hash, first_name, last_name)
     select $1, $2, $3, coalesce(nullif($4, ''), users.password_hash), $5, $6
     from users
     where users.id = $1
     on conflict (email) do update
     set name = excluded.name,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         updated_at = now()`,
    [
      user.id,
      firstName,
      user.email.toLowerCase(),
      user.password_hash || "",
      firstName,
      lastName,
    ],
  );
}

async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + sessionExpiryMs;
  await query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [
    hashToken(token),
    userId,
    new Date(expiresAt),
  ]);
  return { token, expiresAt };
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

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
