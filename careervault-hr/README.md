# CareerVault HR Portal

Separate Next.js application for HR teams to create and manage candidate document requests.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

- HR Portal: [http://localhost:3001](http://localhost:3001)
- User Portal (candidate flow): [http://localhost:3000](http://localhost:3000)

Both apps share the same `DATABASE_URL`.

## Request email delivery

Configure transactional email in `.env.local` (same settings as User Portal). See [docs/EMAIL_SETUP.md](../docs/EMAIL_SETUP.md).

- `RESEND_API_KEY` + `EMAIL_FROM` on a **verified domain** (recommended)
- Optional: `BREVO_API_KEY` + verified Brevo sender

Never use `onboarding@resend.dev` or `@resend.dev` for OTP or candidate mail.

The HR Portal records every delivery attempt. A failed delivery keeps the secure request active and
allows HR to resend the same link without rotating it.

## Authentication

HR Portal hosts its own login and create-account flow for **recruiter** accounts.

- Create or sign in at [http://localhost:3001/login](http://localhost:3001/login)
- Passwords are hashed with scrypt (same approach as the User Portal)
- Accounts are stored in the shared `users` table with `role = 'recruiter'` plus a matching `hr_users` row
- Successful HR login opens the HR Portal dashboard
- User Portal employee login opens the User Portal dashboard
- Recruiters who sign in on the User Portal are redirected to this HR Portal
- Both apps use the shared `cv_session` cookie and `sessions` table

For separate production subdomains, set `SESSION_COOKIE_DOMAIN` to their shared parent domain,
such as `.company.com`, in both deployments.

## Deployment

Deploy this app independently from the User Portal. Set `NEXT_PUBLIC_USER_PORTAL_URL` to the production User Portal URL so generated request links point to the correct domain.

Future hosting options:

- Subdomains: `hr.company.com` + `app.company.com`
- Path-based routing via reverse proxy: `company.com/hr`
