# Production email setup (OTP & transactional mail)

CareerVault sends signup OTP, forgot-password OTP, and document-request emails to **the exact address the user entered**. Delivery fails if you use Resend’s shared testing sender `onboarding@resend.dev` — that domain only delivers to the Resend account owner’s inbox.

## Why `onboarding@resend.dev` cannot be used

Resend restricts the `@resend.dev` testing domain so outbound mail only reaches the account owner. Any other recipient gets a 403. This is intentional and cannot be bypassed in application code.

## Quick configure (existing Resend account)

If you already have a Resend API key and a **verified** domain:

```powershell
$env:RESEND_API_KEY="re_your_full_access_key"
$env:EMAIL_DOMAIN="mail.yourdomain.com"   # optional if already verified in Resend
$env:EMAIL_TEST_TO="candidate@gmail.com"  # optional live test
npm run configure:resend
```

Then restart both portals and confirm:

`http://localhost:3000/api/auth/email-status` → `configured: true`, `canSendToAnyRecipient: true`

**Do not use `onboarding@resend.dev`.** That sender only delivers to the Resend account owner's inbox, which is why earlier test emails appeared to "work" for one address but failed for real candidates.

## Automated setup (Resend + Cloudflare DNS)

There is **no fully free custom domain** for production email (registrars charge at-cost, typically ~$10/year). Cloudflare does not provide free `.com` domains. After you **purchase or already own** a domain and point its DNS to Cloudflare:

1. Add to `careervault/.env.local`:

```env
RESEND_API_KEY=re_your_full_access_key
EMAIL_DOMAIN=mail.yourdomain.com
CLOUDFLARE_API_TOKEN=your_token_with_Zone_DNS_Edit
CLOUDFLARE_ZONE_ID=your_zone_id
EMAIL_TEST_TO=any-recipient@gmail.com
```

2. Run from repo root:

```bash
npm run setup:email
```

The script will:

- Create or reuse the domain in Resend
- Publish SPF, DKIM, MX (and DMARC) to Cloudflare when credentials are set
- Poll until Resend marks the domain **verified**
- Set `EMAIL_FROM=noreply@<EMAIL_DOMAIN>` in both portal `.env.local` files
- Optionally send a test message to `EMAIL_TEST_TO`

3. Restart both apps and run:

```bash
npm run check:email-status
```

### Manual steps (required once)

| Step | Why automation cannot skip it |
|------|-------------------------------|
| Buy/register domain | Requires payment and registrar account |
| Create Resend account + API key | Account owner verification |
| Create Cloudflare API token | Security — tokens are secret |
| Use **full-access** Resend key for `setup:email` | Send-only keys cannot manage domains (401/403) |

### Test all email flows

After `canSendToAnyRecipient: true`:

1. **Signup OTP** — create account with `user@gmail.com`, code arrives at that inbox  
2. **Forgot password** — reset for an existing user  
3. **HR request** — create document request in HR portal to a candidate email  
4. **Candidate email** — same request link email to the candidate address  

## Recommended: Resend + verified custom domain

### 1. Domain

If you do not own a domain yet, inexpensive options with simple DNS:

| Provider   | Typical .com price | Notes                          |
|-----------|--------------------|--------------------------------|
| Porkbun   | ~$9–11/year        | Low cost, straightforward DNS  |
| Namecheap | ~$10–14/year       | Common choice for startups     |
| Cloudflare| At-cost registration | Best if you already use Cloudflare DNS |

Use a subdomain for mail when possible, e.g. `mail.careervault.app` or `notifications.yourdomain.com`.

### 2. Add domain in Resend

1. [Resend → Domains](https://resend.com/domains) → **Add domain**
2. Enter your subdomain (recommended) or root domain
3. Resend shows DNS records to add at your registrar/DNS host

### 3. DNS records (exact types)

Resend generates **host-specific values** in the dashboard. You add:

| Purpose      | Type | Host (example)                    | Value source                          |
|-------------|------|-----------------------------------|---------------------------------------|
| **DKIM**    | TXT  | `resend._domainkey.yourdomain.com`| Copy full TXT from Resend (public key)|
| **SPF**     | TXT  | `send.yourdomain.com` (return path)| `v=spf1 include:amazonses.com ~all` (Resend shows exact) |
| **Return path MX** | MX | `send.yourdomain.com`        | MX target + priority from Resend      |
| **DMARC** (recommended) | TXT | `_dmarc.yourdomain.com` | e.g. `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com` |

On **Cloudflare**, set email-related records to **DNS only** (grey cloud), not proxied.

Click **Verify** in Resend after propagation (often minutes, up to 72 hours).

### 4. Environment variables

Set the same values in **both** `careervault/.env.local` and `careervault-hr/.env.local`:

```env
EMAIL_PROVIDER=auto
RESEND_API_KEY=re_your_full_access_or_sending_key
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=CareerVault
```

Do **not** set `EMAIL_FROM` to `@resend.dev`. Changing domain later only requires updating `EMAIL_FROM` (and DNS in Resend if the domain changes).

Optional fallback provider:

```env
BREVO_API_KEY=xkeysib-...
# EMAIL_FROM must be a verified Brevo sender if Resend is not configured
```

### 5. Verify configuration

Restart both apps, then open:

`http://localhost:3000/api/auth/email-status`

Expected when ready:

- `"configured": true`
- `"provider": "resend"` (or `"brevo"`)
- `"canSendToAnyRecipient": true`
- `"usingTestingSender": false`

### 6. OTP behaviour (already implemented)

- 6-digit code, 10-minute expiry, 60s resend cooldown
- Max 5 verification attempts per code
- Max 5 OTP **sends** per email per hour
- Signup: OTP stored in `signup_verifications`, tied to email
- Forgot password: OTP in `password_resets`, tied to account email
- Verified signup OTP required before password creation
- No hardcoded recipient redirects in code

## Alternative: Brevo only

1. [Brevo](https://app.brevo.com) → verify sender or authenticate domain  
2. `BREVO_API_KEY` + `EMAIL_FROM` (verified sender)  
3. Leave `RESEND_API_KEY` empty or omit verified Resend sender — auto mode uses Brevo

## Production checklist

- [ ] Custom domain verified in Resend (or Brevo sender verified)
- [ ] `EMAIL_FROM=noreply@yourdomain.com` (not `@resend.dev`)
- [ ] `RESEND_API_KEY` with send permission
- [ ] Same env in User Portal and HR Portal
- [ ] Test signup with `user@gmail.com` — OTP arrives at `user@gmail.com`
- [ ] Test forgot password for an existing account
