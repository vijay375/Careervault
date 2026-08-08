# Production deployment (single URL, role-based portals)

CareerVault is one public website with shared authentication. Role decides which portal opens after login.

| Experience | Folder | After login |
|------------|--------|-------------|
| **Shared auth** | `careervault/` | https://careervault-rust.vercel.app/ |
| **Employee portal** | `careervault/` | User dashboard on `/` |
| **Recruiter portal** | `careervault-hr/` | HR dashboard on `/hr` (internal route) |

Users never choose a separate HR website. They only use:

**https://careervault-rust.vercel.app/**

- Select **Employee** or **Recruiter** during signup  
- Login once  
- System redirects by the role stored on the account  

`/hr` is an internal protected route for recruiters (not a second public entry). `/hr/login` redirects back to the shared login.

## Architecture

1. **User Portal project** (existing `careervault-rust`)
   - Root Directory: `careervault`
   - Serves `/`
   - Rewrites `/hr` and `/hr/*` to the HR project via `HR_ZONE_URL`

2. **HR Portal project** (create if missing)
   - Root Directory: `careervault-hr`
   - Build-time `NEXT_PUBLIC_BASE_PATH=/hr`
   - Production alias: `https://careervault-hr.vercel.app`
   - Reachable on the main domain through User Portal rewrites at `/hr`

## Required Vercel environment variables

### User Portal (`careervault`)

```env
DATABASE_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=...
EMAIL_FROM=noreply@verify.otp.com
EMAIL_FROM_NAME=CareerVault
EMAIL_PROVIDER=auto
EMAIL_DEV_OTP_FALLBACK=false
NEXT_PUBLIC_APP_URL=https://careervault-rust.vercel.app
NEXT_PUBLIC_USER_PORTAL_URL=https://careervault-rust.vercel.app
NEXT_PUBLIC_HR_PORTAL_URL=https://careervault-rust.vercel.app/hr
HR_ZONE_URL=https://careervault-hr.vercel.app
```

`HR_ZONE_URL` is the **HR project's own** Vercel origin (no path, no trailing slash).  
Never expose `RESEND_API_KEY` with a `NEXT_PUBLIC_` prefix.

### HR Portal (`careervault-hr`)

```env
DATABASE_URL=...   # same production database as User Portal
RESEND_API_KEY=...
EMAIL_FROM=noreply@verify.otp.com
EMAIL_FROM_NAME=CareerVault
EMAIL_PROVIDER=auto
EMAIL_DEV_OTP_FALLBACK=false
NEXT_PUBLIC_BASE_PATH=/hr
NEXT_PUBLIC_USER_PORTAL_URL=https://careervault-rust.vercel.app
NEXT_PUBLIC_APP_URL=https://careervault-rust.vercel.app
```

Use the same `DATABASE_URL` / Supabase project for both portals.

## Local development (unchanged)

```bash
npm run dev      # User Portal :3000
npm run dev:hr   # HR Portal :3001
```

Leave `NEXT_PUBLIC_BASE_PATH` and `HR_ZONE_URL` unset locally.

## Deploy checklist

1. Push this repo to GitHub
2. Confirm User Portal Vercel project Root Directory = `careervault`
3. Create/link HR Vercel project with Root Directory = `careervault-hr`
4. Set env vars on both projects (Production)
5. Deploy HR first, copy its `*.vercel.app` URL into User Portal `HR_ZONE_URL`
6. Redeploy User Portal so rewrites pick up `HR_ZONE_URL`
7. Verify:
   - https://careervault-rust.vercel.app/
   - https://careervault-rust.vercel.app/hr
   - Employee login stays on User Portal
   - Recruiter login redirects to `/hr`
   - Document-request emails use Resend + candidate account email
