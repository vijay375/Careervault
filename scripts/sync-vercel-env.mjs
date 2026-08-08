/**
 * Sync selected .env.local keys to a linked Vercel project (production).
 * Usage: node scripts/sync-vercel-env.mjs <app-dir> [KEY=VALUE overrides...]
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const appDir = resolve(process.argv[2] || ".");
const overrides = Object.fromEntries(
  process.argv.slice(3).map((entry) => {
    const i = entry.indexOf("=");
    return [entry.slice(0, i), entry.slice(i + 1)];
  }),
);

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const env = { ...loadEnv(resolve(appDir, ".env.local")), ...overrides };
const keys = [
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "DATABASE_CONNECT_TIMEOUT_MS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "EMAIL_DOMAIN",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "EMAIL_DEV_OTP_FALLBACK",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_USER_PORTAL_URL",
  "NEXT_PUBLIC_HR_PORTAL_URL",
  "NEXT_PUBLIC_BASE_PATH",
  "HR_ZONE_URL",
  "SESSION_COOKIE_DOMAIN",
];

for (const key of keys) {
  const value = env[key];
  if (!value) continue;
  // Remove existing then add (idempotent-ish for CLI)
  spawnSync("npx", ["--yes", "vercel@latest", "env", "rm", key, "production", "--yes"], {
    cwd: appDir,
    stdio: "ignore",
    shell: true,
  });
  const added = spawnSync(
    "npx",
    ["--yes", "vercel@latest", "env", "add", key, "production"],
    {
      cwd: appDir,
      input: value,
      encoding: "utf8",
      shell: true,
    },
  );
  if (added.status === 0) {
    console.log(`SET ${key}`);
  } else {
    console.error(`FAIL ${key}: ${(added.stderr || added.stdout || "").slice(0, 200)}`);
  }
}
