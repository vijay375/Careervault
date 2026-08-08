"use client";

import { useEffect, useState } from "react";

const userPortalUrl = (
  process.env.NEXT_PUBLIC_USER_PORTAL_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

/**
 * CareerVault uses one public auth entry (User Portal).
 * Role-based routing after login opens the HR dashboard for recruiters.
 */
export default function HrLoginRedirectPage() {
  const [progress, setProgress] = useState(18);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setProgress((current) => (current >= 92 ? current : current + 10));
    }, 120);

    const target = `${userPortalUrl}/`;
    window.setTimeout(() => {
      window.location.replace(target);
    }, 250);

    return () => window.clearInterval(tick);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0d172b] px-4 text-white">
      <div className="w-full max-w-sm rounded-[20px] border border-white/10 bg-white/5 px-6 py-8 text-center shadow-2xl shadow-black/30 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
          CareerVault
        </p>
        <h1 className="mt-3 text-xl font-semibold">Opening secure sign-in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Employee and Recruiter accounts share one login. After authentication, your role
          opens the correct portal automatically.
        </p>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </main>
  );
}
