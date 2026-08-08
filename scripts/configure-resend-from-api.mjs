#!/usr/bin/env node
/**
 * Configures both portals for live Resend delivery using an existing API key.
 *
 * Usage (from repo root):
 *   set RESEND_API_KEY=re_xxx
 *   set EMAIL_DOMAIN=mail.yourdomain.com   (optional if a verified domain already exists)
 *   set EMAIL_TEST_TO=candidate@gmail.com  (optional test send)
 *   node scripts/configure-resend-from-api.mjs
 *
 * The script:
 * - Validates the API key
 * - Lists Resend domains and picks a verified one (or EMAIL_DOMAIN)
 * - Writes RESEND_API_KEY + EMAIL_FROM into careervault/.env.local and careervault-hr/.env.local
 * - Optionally sends a test email to EMAIL_TEST_TO
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }
  const entries = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function upsertEnvValue(filePath, key, value) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${key}=${value}\n`, "utf8");
    return;
  }
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    updated.push(`${key}=${value}`);
  }
  writeFileSync(filePath, `${updated.join("\n").replace(/\n*$/, "")}\n`, "utf8");
}

async function resendFetch(apiKey, path, options = {}) {
  const response = await fetch(`https://api.resend.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const message = body.message || body.name || text || response.statusText;
    throw new Error(`Resend ${path} failed (${response.status}): ${message}`);
  }
  return body;
}

function isTestingSender(email) {
  return String(email || "")
    .toLowerCase()
    .endsWith("@resend.dev");
}

async function main() {
  const fileEnv = {
    ...loadEnvFile(resolve(root, "careervault", ".env.local")),
    ...loadEnvFile(resolve(root, "careervault-hr", ".env.local")),
  };
  const env = { ...fileEnv, ...process.env };
  const apiKey = String(env.RESEND_API_KEY || "").trim();

  if (!apiKey || apiKey.includes("your-") || !apiKey.startsWith("re_")) {
    console.error(`
Missing a real RESEND_API_KEY.

1) Create a key at https://resend.com/api-keys
2) Verify a domain at https://resend.com/domains
3) Run:

   $env:RESEND_API_KEY="re_xxxxxxxx"
   $env:EMAIL_DOMAIN="mail.yourdomain.com"   # optional if already verified
   $env:EMAIL_TEST_TO="candidate@gmail.com"  # optional
   node scripts/configure-resend-from-api.mjs
`);
    process.exit(1);
  }

  console.log("Validating Resend API key…");
  const domainsResponse = await resendFetch(apiKey, "/domains");
  const domains = Array.isArray(domainsResponse.data) ? domainsResponse.data : [];
  console.log(`Found ${domains.length} domain(s) in Resend.`);

  for (const domain of domains) {
    console.log(`  - ${domain.name} [${domain.status}]`);
  }

  const preferred = String(env.EMAIL_DOMAIN || "").trim().toLowerCase();
  let selected =
    domains.find(
      (domain) =>
        domain.status === "verified" &&
        (!preferred || domain.name.toLowerCase() === preferred),
    ) || domains.find((domain) => domain.status === "verified");

  if (!selected && preferred) {
    console.log(`\nNo verified domain matched ${preferred}. Creating/fetching it…`);
    try {
      selected = await resendFetch(apiKey, "/domains", {
        method: "POST",
        body: JSON.stringify({ name: preferred }),
      });
    } catch (error) {
      console.error(String(error.message || error));
      console.error(
        "Add DNS records in the Resend dashboard, wait for verification, then re-run.",
      );
      process.exit(2);
    }
  }

  if (!selected || selected.status !== "verified") {
    console.error(`
No verified Resend domain is available yet.

- Add a domain you own at https://resend.com/domains
- Publish the SPF/DKIM records Resend shows
- Wait until status is "verified"
- Re-run this script

Do NOT use onboarding@resend.dev for candidate emails — it only delivers to your Resend account inbox.
`);
    process.exit(2);
  }

  const emailFrom = `noreply@${selected.name}`;
  if (isTestingSender(emailFrom)) {
    console.error("Refusing to configure a @resend.dev sender for production delivery.");
    process.exit(2);
  }

  const userEnv = resolve(root, "careervault", ".env.local");
  const hrEnv = resolve(root, "careervault-hr", ".env.local");

  for (const filePath of [userEnv, hrEnv]) {
    upsertEnvValue(filePath, "EMAIL_PROVIDER", "auto");
    upsertEnvValue(filePath, "RESEND_API_KEY", apiKey);
    upsertEnvValue(filePath, "EMAIL_DOMAIN", selected.name);
    upsertEnvValue(filePath, "EMAIL_FROM", emailFrom);
    upsertEnvValue(filePath, "EMAIL_FROM_NAME", env.EMAIL_FROM_NAME || "CareerVault");
  }

  console.log(`\nConfigured both portals:`);
  console.log(`  EMAIL_FROM=${emailFrom}`);
  console.log(`  EMAIL_DOMAIN=${selected.name}`);
  console.log(`  RESEND_API_KEY=<set>`);
  console.log(`\nRestart both Next.js apps after this.`);

  const testTo = String(env.EMAIL_TEST_TO || "").trim().toLowerCase();
  if (testTo) {
    console.log(`\nSending test email to ${testTo}…`);
    const result = await resendFetch(apiKey, "/emails", {
      method: "POST",
      body: JSON.stringify({
        from: `CareerVault <${emailFrom}>`,
        to: [testTo],
        subject: "CareerVault Resend configuration test",
        text: "CareerVault email delivery is configured correctly.",
        html: "<p>CareerVault email delivery is configured correctly.</p>",
      }),
    });
    console.log(`Test accepted by Resend. id=${result.id || "unknown"}`);
  } else {
    console.log(
      "\nOptional: set EMAIL_TEST_TO=someone@gmail.com and re-run to send a live test.",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
