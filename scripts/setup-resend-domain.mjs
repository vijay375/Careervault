#!/usr/bin/env node
/**
 * Automates Resend domain registration + optional Cloudflare DNS + env updates.
 *
 * Prerequisites (manual — cannot be done from code):
 * - Own a domain (Cloudflare Registrar ~at-cost; there is no fully free custom TLD)
 * - Resend API key with domain + send permissions (not send-only restricted key)
 * - Cloudflare API token with Zone.DNS Edit (if using CLOUDFLARE_ZONE_ID)
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx EMAIL_DOMAIN=mail.yourdomain.com \
 *   CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ZONE_ID=xxx \
 *   node scripts/setup-resend-domain.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
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

function mergeEnv() {
  const fileEnv = loadEnvFile(resolve(root, "careervault", ".env.local"));
  return { ...fileEnv, ...process.env };
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
    const message = body.message || body.error || text || response.statusText;
    throw new Error(`Resend ${path} failed (${response.status}): ${message}`);
  }
  return body;
}

async function cloudflareUpsertRecord(token, zoneId, record) {
  const listUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=${encodeURIComponent(record.type)}&name=${encodeURIComponent(record.name)}`;
  const list = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  }).then((r) => r.json());

  const payload = {
    type: record.type,
    name: record.name,
    content: record.content,
    ttl: 1,
    proxied: false,
    ...(record.priority !== undefined ? { priority: record.priority } : {}),
  };

  const existing = list.result?.[0];
  const url = existing
    ? `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existing.id}`
    : `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
  const method = existing ? "PATCH" : "POST";
  const result = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

  if (!result.success) {
    throw new Error(
      `Cloudflare DNS ${method} failed for ${record.name}: ${JSON.stringify(result.errors || result)}`,
    );
  }
  console.log(`  ✓ DNS ${record.type} ${record.name}`);
}

function fqdn(recordName, domain) {
  if (!recordName || recordName === "@") {
    return domain;
  }
  if (recordName.includes(".")) {
    return recordName.endsWith(domain) ? recordName : `${recordName}.${domain}`;
  }
  return `${recordName}.${domain}`;
}

function dmarcRecord(domain) {
  return {
    type: "TXT",
    name: `_dmarc.${domain}`,
    content: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
  };
}

async function main() {
  const env = mergeEnv();
  const apiKey = env.RESEND_API_KEY?.trim();
  const domain = env.EMAIL_DOMAIN?.trim();
  const cfToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const cfZone = env.CLOUDFLARE_ZONE_ID?.trim();
  const fromLocal = env.EMAIL_FROM_LOCAL_PART?.trim() || "noreply";

  console.log("\nCareerVault — Resend domain setup\n");

  if (!apiKey) {
    console.error("Missing RESEND_API_KEY. Add a full-access Resend key to careervault/.env.local");
    process.exit(1);
  }
  if (!domain) {
    console.error("Missing EMAIL_DOMAIN (e.g. mail.yourdomain.com) in careervault/.env.local");
    process.exit(1);
  }

  console.log(`Domain: ${domain}`);

  let domainId;
  const existing = await resendFetch(apiKey, "/domains");
  const match = (existing.data || []).find((item) => item.name === domain);
  if (match) {
    domainId = match.id;
    console.log(`Using existing Resend domain (${domainId})`);
  } else {
    const created = await resendFetch(apiKey, "/domains", {
      method: "POST",
      body: JSON.stringify({ name: domain, region: env.RESEND_REGION || "ap-northeast-1" }),
    });
    domainId = created.id;
    console.log(`Created Resend domain (${domainId})`);
  }

  const details = await resendFetch(apiKey, `/domains/${domainId}`);
  const records = details.records || [];
  if (!records.length) {
    console.warn("No DNS records returned yet. Open Resend dashboard → Domains → Records.");
  }

  if (cfToken && cfZone) {
    console.log("\nApplying DNS via Cloudflare…");
    for (const record of records) {
      if (!record.type || !record.name) {
        continue;
      }
      if (record.record === "Tracking") {
        continue;
      }
      const name = fqdn(record.name, domain);
      let content = record.value;
      if (record.type === "TXT" && content && !content.startsWith('"')) {
        content = content.replace(/^"|"$/g, "");
      }
      if (record.type === "CNAME" && content?.endsWith(".")) {
        content = content.slice(0, -1);
      }
      await cloudflareUpsertRecord(cfToken, cfZone, {
        type: record.type,
        name,
        content,
        priority: record.priority,
      });
    }
    await cloudflareUpsertRecord(cfToken, cfZone, dmarcRecord(domain));
  } else {
    console.log("\nCloudflare not configured — add these records manually at your DNS host:\n");
    for (const record of records) {
      console.log(
        `  ${record.type}  ${fqdn(record.name, domain)}  →  ${record.value}${record.priority ? ` (priority ${record.priority})` : ""}`,
      );
    }
    console.log(`  TXT  _dmarc.${domain}  →  v=DMARC1; p=none; rua=mailto:dmarc@${domain}`);
  }

  console.log("\nRequesting Resend verification…");
  await resendFetch(apiKey, `/domains/${domainId}/verify`, { method: "POST", body: "{}" });

  const maxAttempts = 60;
  let verified = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const status = await resendFetch(apiKey, `/domains/${domainId}`);
    console.log(`  Poll ${attempt}/${maxAttempts}: status=${status.status}`);
    if (status.status === "verified") {
      verified = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }

  if (!verified) {
    console.error(
      "\nDomain not verified yet. DNS may still be propagating (up to 72h). Re-run this script later or verify in the Resend dashboard.",
    );
    process.exit(2);
  }

  const emailFrom = `${fromLocal}@${domain}`;
  const userEnv = resolve(root, "careervault", ".env.local");
  const hrEnv = resolve(root, "careervault-hr", ".env.local");

  upsertEnvValue(userEnv, "EMAIL_PROVIDER", "auto");
  upsertEnvValue(userEnv, "RESEND_API_KEY", apiKey);
  upsertEnvValue(userEnv, "EMAIL_FROM", emailFrom);
  upsertEnvValue(userEnv, "EMAIL_FROM_NAME", env.EMAIL_FROM_NAME || "CareerVault");
  upsertEnvValue(hrEnv, "EMAIL_PROVIDER", "auto");
  upsertEnvValue(hrEnv, "RESEND_API_KEY", apiKey);
  upsertEnvValue(hrEnv, "EMAIL_FROM", emailFrom);
  upsertEnvValue(hrEnv, "EMAIL_FROM_NAME", env.EMAIL_FROM_NAME || "CareerVault");

  console.log(`\nUpdated EMAIL_FROM=${emailFrom} in both portals.`);
  console.log("Restart both Next.js apps, then open http://localhost:3000/api/auth/email-status\n");

  const testTo = env.EMAIL_TEST_TO?.trim();
  if (testTo) {
    console.log(`Sending test email to ${testTo}…`);
    await resendFetch(apiKey, "/emails", {
      method: "POST",
      body: JSON.stringify({
        from: `CareerVault <${emailFrom}>`,
        to: [testTo],
        subject: "CareerVault email delivery test",
        text: "If you received this, Resend domain delivery is working for any recipient.",
      }),
    });
    console.log("Test email accepted by Resend.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
