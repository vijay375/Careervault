"use client";

import { useRouter } from "next/navigation";

export default function VerifyEmailPage() {
  const router = useRouter();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0d172b] px-4 py-8 text-white">
      <section className="w-full max-w-lg rounded-[24px] border border-white/10 bg-white p-8 text-slate-950 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-blue-600 text-lg font-bold text-white">
            CV
          </div>
          <div>
            <h1 className="text-xl font-bold">CareerVault</h1>
            <p className="text-sm text-slate-500">Account creation</p>
          </div>
        </div>
        <div className="rounded-[16px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
          Email verification is no longer required for account creation.
        </div>
        <p className="mt-4 text-sm text-slate-600">
          Create your account with your role, email, and password, then sign in.
        </p>
        <button
          className="mt-6 h-11 w-full rounded-[16px] bg-blue-600 text-sm font-bold text-white hover:bg-blue-700"
          onClick={() => router.replace("/?auth=signup")}
          type="button"
        >
          Create Account
        </button>
        <button
          className="mt-3 h-11 w-full rounded-[16px] border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={() => router.replace("/?auth=login")}
          type="button"
        >
          Go to Login
        </button>
      </section>
    </main>
  );
}
