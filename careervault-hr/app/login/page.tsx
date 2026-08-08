"use client";

import { Eye, EyeOff } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";

type AuthMode = "login" | "signup";

const signupStepCount = 4;

const emptySignupDraft = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
};

type SignupDraft = typeof emptySignupDraft;
type SignupFieldErrors = Partial<Record<keyof SignupDraft, string>>;

function getPasswordPolicyMessage(password: string) {
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

export default function HrLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionProgress, setSessionProgress] = useState(12);
  const [showPassword, setShowPassword] = useState(false);
  const [prefillEmail, setPrefillEmail] = useState("");
  const [signupKey, setSignupKey] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        setSessionProgress(35);
        const response = await fetch(withBasePath("/api/auth/session"), {
          credentials: "include",
        });
        setSessionProgress(70);
        if (response.ok) {
          setSessionProgress(100);
          router.replace("/");
          return;
        }
      } catch {
        // stay on login
      } finally {
        setSessionProgress(100);
        window.setTimeout(() => setCheckingSession(false), 180);
      }
    })();
  }, [router]);

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "").trim();

    setLoading(true);
    setMessage("");
    const response = await fetch(withBasePath("/api/auth/login"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = (await response.json()) as { ok?: boolean; message?: string };
    setLoading(false);

    if (data.ok) {
      router.replace("/");
      return;
    }

    setMessage(data.message || "We could not sign you in. Please try again.");
  }

  async function handleSignupSubmit(draft: SignupDraft) {
    if (loading) {
      return;
    }

    setLoading(true);
    setMessage("");
    const response = await fetch(withBasePath("/api/auth/signup"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        email: draft.email.trim(),
        password: draft.password,
      }),
    });
    const data = (await response.json()) as { ok?: boolean; message?: string };
    setLoading(false);
    setMessage(data.message || "Something went wrong. Please try again.");
    if (data.ok) {
      setPrefillEmail(draft.email.trim());
      setMode("login");
      setSignupKey((key) => key + 1);
    }
  }

  const isError =
    message.startsWith("No ") ||
    message.startsWith("Password") ||
    message.startsWith("Passwords") ||
    message.startsWith("An account") ||
    message.startsWith("Please") ||
    message.startsWith("We could");

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d172b] text-white">
        <SessionLoader progress={sessionProgress} />
      </main>
    );
  }

  const isSignup = mode === "signup";

  return (
    <main
      className={`flex min-h-screen items-center justify-center bg-[#0d172b] px-4 py-6 text-white sm:py-8 ${
        isSignup ? "overflow-hidden" : ""
      }`}
    >
      <section
        className={`grid w-full max-w-5xl overflow-hidden rounded-[20px] border border-white/10 bg-white/5 shadow-2xl shadow-black/30 backdrop-blur lg:grid-cols-[1fr_420px] ${
          isSignup
            ? "max-h-[calc(100dvh-3rem)] lg:h-[min(600px,calc(100dvh-4rem))]"
            : ""
        }`}
      >
        <div
          className={`${
            isSignup ? "hidden lg:block" : ""
          } bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.45),transparent_32%),linear-gradient(135deg,#0d172b,#0f2f83)] p-8 sm:p-10`}
        >
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-blue-500 text-xl font-bold">
              CV
            </div>
            <div>
              <h1 className="text-2xl font-bold">CareerVault</h1>
              <p className="text-blue-100">Secure Document Hub</p>
            </div>
          </div>
          <h2 className="mt-16 max-w-xl text-4xl font-bold tracking-tight sm:text-5xl">
            Your career documents, organized and ready.
          </h2>
          <p className="mt-4 max-w-xl leading-7 text-blue-100">
            Store, search, preview, and manage employment records with a polished
            document workflow.
          </p>
        </div>

        {isSignup ? (
          <HrSignupWizard
            isLoading={loading}
            key={signupKey}
            message={message}
            onAuthModeChange={(nextMode) => {
              setMode(nextMode);
              setMessage("");
            }}
            onSubmit={handleSignupSubmit}
          />
        ) : (
          <form className="bg-white p-6 text-slate-950 sm:p-8" onSubmit={handleLoginSubmit}>
            <h2 className="text-2xl font-bold">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-500">
              Sign in to access your protected vault.
            </p>

            {message ? (
              <p
                className={`mt-4 rounded-[20px] border px-4 py-3 text-sm font-semibold ${
                  isError
                    ? "border-red-100 bg-red-50 text-red-700"
                    : "border-blue-100 bg-blue-50 text-blue-800"
                }`}
              >
                {message}
              </p>
            ) : null}

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Email</span>
                <input
                  autoComplete="email"
                  className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  defaultValue={prefillEmail}
                  key={`login-email-${prefillEmail}`}
                  name="email"
                  placeholder="Enter your email"
                  required
                  type="email"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Password</span>
                <div className="mt-2 flex h-11 items-center rounded-[20px] border border-slate-200 px-3 focus-within:border-blue-400">
                  <input
                    autoComplete="current-password"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                    minLength={8}
                    name="password"
                    placeholder="Enter your password"
                    required
                    type={showPassword ? "text" : "password"}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="ml-2 text-slate-400 transition hover:text-blue-700"
                    onClick={() => setShowPassword((current) => !current)}
                    type="button"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
            </div>

            <button
              className="mt-6 h-11 w-full rounded-[20px] bg-blue-600 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={loading}
            >
              {loading ? "Please wait..." : "Sign in"}
            </button>

            <button
              className="mt-4 w-full text-sm font-semibold text-blue-700"
              onClick={() => {
                setMode("signup");
                setMessage("");
                setSignupKey((key) => key + 1);
              }}
              type="button"
            >
              I don&apos;t have an account
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function HrSignupWizard({
  isLoading,
  message,
  onAuthModeChange,
  onSubmit,
}: {
  isLoading: boolean;
  message: string;
  onAuthModeChange: (mode: AuthMode) => void;
  onSubmit: (draft: SignupDraft) => void;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<SignupDraft>(emptySignupDraft);
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const isError =
    message.startsWith("No ") ||
    message.startsWith("Password") ||
    message.startsWith("Passwords") ||
    message.startsWith("An account") ||
    message.startsWith("Please") ||
    message.startsWith("We could") ||
    message.startsWith("Something");

  const subtitle =
    step === 1
      ? "Tell us your name to personalize your HR portal."
      : step === 2
        ? "Add the email you’ll use to sign in."
        : step === 3
          ? "Create a strong password to protect your account."
          : "Review your details, then create your account.";

  function updateDraft<K extends keyof SignupDraft>(key: K, value: SignupDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function getStepErrors(currentStep: number) {
    const errors: SignupFieldErrors = {};

    if (currentStep === 1) {
      if (!draft.firstName.trim()) {
        errors.firstName = "Please enter your first name.";
      }
      if (!draft.lastName.trim()) {
        errors.lastName = "Please enter your last name.";
      }
    }

    if (currentStep === 2) {
      if (!draft.email.trim()) {
        errors.email = "Please enter your email address.";
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
        errors.email = "Please enter a valid email address.";
      }
    }

    if (currentStep === 3) {
      const passwordMessage = getPasswordPolicyMessage(draft.password);
      if (passwordMessage) {
        errors.password = passwordMessage;
      }
      if (!draft.confirmPassword) {
        errors.confirmPassword = "Please confirm your password.";
      } else if (draft.password !== draft.confirmPassword) {
        errors.confirmPassword = "Passwords do not match. Please try again.";
      }
    }

    return errors;
  }

  function validateStep(currentStep: number) {
    const errors = getStepErrors(currentStep);
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) {
      return;
    }
    setStep((current) => Math.min(current + 1, signupStepCount));
  }

  function goBack() {
    setFieldErrors({});
    setStep((current) => Math.max(current - 1, 1));
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < signupStepCount) {
      goNext();
      return;
    }

    for (const checkStep of [1, 2, 3] as const) {
      const errors = getStepErrors(checkStep);
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setStep(checkStep);
        return;
      }
    }

    onSubmit(draft);
  }

  const inputClass = (hasError?: string) =>
    `mt-2 h-11 w-full rounded-[20px] border px-3 text-sm outline-none focus:border-blue-400 ${
      hasError ? "border-red-300" : "border-slate-200"
    }`;

  return (
    <form
      className="flex h-full min-h-0 flex-col bg-white p-6 text-slate-950 sm:p-8"
      onSubmit={handleFormSubmit}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">
        Step {step} of {signupStepCount}
      </p>
      <h2 className="mt-2 text-2xl font-bold">Create account</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>

      {message && step === signupStepCount ? (
        <p
          className={`mt-3 shrink-0 rounded-[20px] border px-4 py-3 text-sm font-semibold ${
            isError
              ? "border-red-100 bg-red-50 text-red-700"
              : "border-blue-100 bg-blue-50 text-blue-800"
          }`}
        >
          {message}
        </p>
      ) : null}

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        <div className="careervault-fade-in space-y-4" key={step}>
          {step === 1 ? (
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">First Name</span>
                <input
                  autoComplete="given-name"
                  className={inputClass(fieldErrors.firstName)}
                  onChange={(event) => updateDraft("firstName", event.target.value)}
                  placeholder="Enter your first name"
                  value={draft.firstName}
                />
                {fieldErrors.firstName ? (
                  <span className="mt-1.5 block text-xs font-medium text-red-600">
                    {fieldErrors.firstName}
                  </span>
                ) : null}
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Last Name</span>
                <input
                  autoComplete="family-name"
                  className={inputClass(fieldErrors.lastName)}
                  onChange={(event) => updateDraft("lastName", event.target.value)}
                  placeholder="Enter your last name"
                  value={draft.lastName}
                />
                {fieldErrors.lastName ? (
                  <span className="mt-1.5 block text-xs font-medium text-red-600">
                    {fieldErrors.lastName}
                  </span>
                ) : null}
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Email</span>
              <input
                autoComplete="email"
                className={inputClass(fieldErrors.email)}
                onChange={(event) => updateDraft("email", event.target.value)}
                placeholder="Enter your email"
                type="email"
                value={draft.email}
              />
              {fieldErrors.email ? (
                <span className="mt-1.5 block text-xs font-medium text-red-600">
                  {fieldErrors.email}
                </span>
              ) : null}
            </label>
          ) : null}

          {step === 3 ? (
            <>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Password</span>
                <div
                  className={`mt-2 flex h-11 items-center rounded-[20px] border px-3 focus-within:border-blue-400 ${
                    fieldErrors.password ? "border-red-300" : "border-slate-200"
                  }`}
                >
                  <input
                    autoComplete="new-password"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                    onChange={(event) => updateDraft("password", event.target.value)}
                    placeholder="Create a password"
                    type={showPassword ? "text" : "password"}
                    value={draft.password}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="ml-2 text-slate-400 transition hover:text-blue-700"
                    onClick={() => setShowPassword((current) => !current)}
                    type="button"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <span className="mt-1.5 block text-xs font-medium text-red-600">
                    {fieldErrors.password}
                  </span>
                ) : null}
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Confirm password</span>
                <div
                  className={`mt-2 flex h-11 items-center rounded-[20px] border px-3 focus-within:border-blue-400 ${
                    fieldErrors.confirmPassword ? "border-red-300" : "border-slate-200"
                  }`}
                >
                  <input
                    autoComplete="new-password"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                    onChange={(event) => updateDraft("confirmPassword", event.target.value)}
                    placeholder="Confirm your password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={draft.confirmPassword}
                  />
                  <button
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    className="ml-2 text-slate-400 transition hover:text-blue-700"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    type="button"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.confirmPassword ? (
                  <span className="mt-1.5 block text-xs font-medium text-red-600">
                    {fieldErrors.confirmPassword}
                  </span>
                ) : null}
              </label>
              <p className="rounded-[20px] bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                Use at least 8 characters with uppercase, lowercase, and a number.
              </p>
            </>
          ) : null}

          {step === 4 ? (
            <div className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex items-start justify-between gap-4">
                <span className="shrink-0 text-slate-500">Name</span>
                <span className="truncate text-right font-semibold text-slate-900">
                  {draft.firstName} {draft.lastName}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="shrink-0 text-slate-500">Email</span>
                <span className="truncate text-right font-semibold text-slate-900">
                  {draft.email}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="shrink-0 text-slate-500">Password</span>
                <span className="truncate text-right font-semibold text-slate-900">
                  ••••••••
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 shrink-0 space-y-3">
        <div className={`grid gap-3 ${step > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {step > 1 ? (
            <button
              className="h-11 w-full rounded-[20px] border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              onClick={goBack}
              type="button"
            >
              Back
            </button>
          ) : null}
          <button
            className="h-11 w-full rounded-[20px] bg-blue-600 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            disabled={isLoading}
            type="submit"
          >
            {isLoading
              ? "Please wait..."
              : step === signupStepCount
                ? "Create Account"
                : "Next"}
          </button>
        </div>
        <button
          className="w-full text-sm font-semibold text-blue-700"
          onClick={() => onAuthModeChange("login")}
          type="button"
        >
          Already have an account? Sign in
        </button>
      </div>
    </form>
  );
}

function SessionLoader({ progress }: { progress: number }) {
  const [displayProgress, setDisplayProgress] = useState(0);
  const displayProgressRef = useRef(0);

  useEffect(() => {
    displayProgressRef.current = displayProgress;
  }, [displayProgress]);

  useEffect(() => {
    const target = Math.max(0, Math.min(100, progress));
    let frame = 0;
    const from = displayProgressRef.current;
    const startTime = performance.now();
    const duration = 320;

    function tick(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextValue = Math.round(from + (target - from) * eased);
      displayProgressRef.current = nextValue;
      setDisplayProgress(nextValue);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  return (
    <div
      aria-label={`Loading ${displayProgress} percent`}
      aria-live="polite"
      className="relative flex items-center justify-center"
      role="status"
    >
      <span className="sr-only">Loading {displayProgress}%</span>
      <div
        aria-hidden="true"
        className="absolute h-16 w-16 rounded-full bg-blue-500/20 blur-2xl sm:h-20 sm:w-20"
      />
      <div className="relative h-12 w-12 sm:h-14 sm:w-14">
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-spin rounded-full border-[3px] border-white/10 border-t-blue-400 border-r-blue-500 shadow-[0_0_28px_rgba(59,130,246,0.22)] sm:border-4"
        />
        <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-[#0d172b] sm:inset-[6px]">
          <span className="text-[9px] font-bold tabular-nums tracking-tight text-blue-100 sm:text-[10px]">
            {displayProgress}%
          </span>
        </div>
      </div>
    </div>
  );
}
