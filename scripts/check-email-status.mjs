#!/usr/bin/env node
/** Poll local email-status endpoint after dev servers start. */

const url = process.env.EMAIL_STATUS_URL || "http://localhost:3000/api/auth/email-status";
const maxAttempts = 20;

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      const body = await response.json();
      console.log(JSON.stringify(body, null, 2));
      process.exit(response.ok ? 0 : 1);
    } catch (error) {
      console.log(`Attempt ${attempt}/${maxAttempts}: server not ready (${error.message})`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  console.error("Could not reach email-status. Is the user portal running on port 3000?");
  process.exit(1);
}

main();
