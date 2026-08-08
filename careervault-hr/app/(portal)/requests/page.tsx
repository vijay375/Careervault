"use client";

import { Check, CheckCircle2, ChevronDown, Copy, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  DropdownSelect,
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from "@/components/hr-shell";
import { withBasePath } from "@/lib/base-path";
import { defaultExpiryHours, documentTypes, expiryHourOptions } from "@/lib/hr-data";

type CandidateAccount = {
  id: string;
  email: string;
  name: string;
};

export default function RequestsPage() {
  const router = useRouter();
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidateUserId, setCandidateUserId] = useState("");
  const [accountMatches, setAccountMatches] = useState<CandidateAccount[]>([]);
  const [selectedAccountEmail, setSelectedAccountEmail] = useState("");
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [customDocument, setCustomDocument] = useState("");
  const [customDocuments, setCustomDocuments] = useState<string[]>([]);
  const [expiryHours, setExpiryHours] = useState(String(defaultExpiryHours));
  const [customExpiresAt, setCustomExpiresAt] = useState("");
  const [minimumCustomExpiry] = useState(() =>
    new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16),
  );
  const [requestLink, setRequestLink] = useState("");
  const [createdRequestId, setCreatedRequestId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDocumentMenuOpen, setIsDocumentMenuOpen] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [emailSetupHint, setEmailSetupHint] = useState("");
  const documentMenuRef = useRef<HTMLDivElement>(null);
  const candidateLookupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(withBasePath("/api/auth/email-status"), {
          credentials: "include",
        });
        if (!response.ok) {
          setEmailConfigured(false);
          setEmailSetupHint(
            "Email status could not be loaded. Ensure RESEND_API_KEY and EMAIL_FROM are set in careervault-hr/.env.local.",
          );
          return;
        }
        const data = (await response.json()) as {
          configured?: boolean;
          canSendToAnyRecipient?: boolean;
          setupHint?: string;
          missing?: string[];
        };
        const ready = Boolean(data.configured && data.canSendToAnyRecipient);
        setEmailConfigured(ready);
        setEmailSetupHint(
          ready
            ? ""
            : data.setupHint ||
              `Email delivery is not ready. Missing: ${(data.missing || []).join(", ") || "RESEND_API_KEY and verified EMAIL_FROM"}.`,
        );
      } catch {
        setEmailConfigured(false);
        setEmailSetupHint(
          "Email status could not be loaded. Restart the HR Portal after updating .env.local.",
        );
      }
    })();
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!documentMenuRef.current?.contains(event.target as Node)) {
        setIsDocumentMenuOpen(false);
      }
      if (!candidateLookupRef.current?.contains(event.target as Node)) {
        setAccountMatches([]);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDocumentMenuOpen(false);
        setAccountMatches([]);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    const term = candidateEmail.trim();
    if (term.length < 2) {
      setAccountMatches([]);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            withBasePath(`/api/candidates/accounts?q=${encodeURIComponent(term)}`),
            { credentials: "include" },
          );
          if (!response.ok) {
            setAccountMatches([]);
            return;
          }
          const data = (await response.json()) as {
            ok?: boolean;
            accounts?: CandidateAccount[];
          };
          setAccountMatches(data.ok ? data.accounts || [] : []);
        } catch {
          setAccountMatches([]);
        }
      })();
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [candidateEmail]);

  function selectCandidateAccount(account: CandidateAccount) {
    setCandidateUserId(account.id);
    setCandidateEmail(account.email);
    setSelectedAccountEmail(account.email);
    setCandidateName((current) => current.trim() || account.name);
    setAccountMatches([]);
  }

  async function resolveCandidateAccountByEmail(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setCandidateUserId("");
      setSelectedAccountEmail("");
      return;
    }

    try {
      const response = await fetch(
        withBasePath(`/api/candidates/accounts?email=${encodeURIComponent(email)}`),
        { credentials: "include" },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        account?: CandidateAccount;
        message?: string;
      };
      if (!response.ok || !data.ok || !data.account) {
        setCandidateUserId("");
        setSelectedAccountEmail("");
        return;
      }

      selectCandidateAccount(data.account);
    } catch {
      setCandidateUserId("");
      setSelectedAccountEmail("");
    }
  }

  function toggleDocument(label: string) {
    setSelectedDocuments((current) =>
      current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label],
    );
  }

  function addCustomDocument() {
    const value = customDocument.trim();
    if (!value) {
      return;
    }

    setCustomDocuments((current) => (current.includes(value) ? current : [...current, value]));
    setCustomDocument("");
  }

  function removeCustomDocument(label: string) {
    setCustomDocuments((current) => current.filter((entry) => entry !== label));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (selectedDocuments.length + customDocuments.length === 0) {
      setError("Select at least one document before generating the request link.");
      return;
    }

    if (expiryHours === "custom" && !customExpiresAt) {
      setError("Choose a custom expiration date and time.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(withBasePath("/api/requests"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName,
          candidateEmail,
          candidateUserId: candidateUserId || undefined,
          documentLabels: selectedDocuments,
          customDocuments,
          expiryHours: expiryHours === "custom" ? undefined : Number(expiryHours),
          expiresAt:
            expiryHours === "custom" && customExpiresAt
              ? new Date(customExpiresAt).toISOString()
              : undefined,
          replaceRequestId: createdRequestId || undefined,
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        message: string;
        emailSent?: boolean;
        recipientEmail?: string;
        request?: { id: string };
        requestLink?: string;
      };

      if (!response.ok || !data.ok) {
        setError(data.message);
        return;
      }

      setRequestLink(data.requestLink || "");
      setCreatedRequestId(data.request?.id || "");
      if (!data.emailSent) {
        setMessage("");
        setError(
          data.message ||
            "The request was created, but email delivery is not configured. Copy the secure link below or add RESEND_API_KEY, then resend.",
        );
        return;
      }

      setError("");
      setMessage(data.message);
      window.setTimeout(() => {
        router.push("/candidates");
      }, 1400);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendEmail() {
    if (!createdRequestId) {
      return;
    }

    setError("");
    const response = await fetch(withBasePath(`/api/requests/${createdRequestId}/resend`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    });
    const data = (await response.json()) as { ok: boolean; message: string };
    if (!response.ok || !data.ok) {
      setError(data.message);
      return;
    }

    setMessage(data.message);
    window.setTimeout(() => router.push("/candidates"), 1200);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Requests"
        subtitle="Create a secure document request, choose required files, and generate a candidate submission link."
        title="Create Document Request"
      />

      {emailConfigured === false ? (
        <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">Email delivery is not configured</p>
          <p className="mt-2 leading-6">{emailSetupHint}</p>
          <p className="mt-2 leading-6">
            Add a Resend API key and verified-domain sender in{" "}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
              careervault-hr/.env.local
            </code>
            , then restart the apps. Do not use{" "}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
              onboarding@resend.dev
            </code>{" "}
            for candidate emails.
          </p>
        </div>
      ) : null}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <Panel
          subtitle="Select a registered CareerVault account. The request email is sent to that account owner's email."
          title="Candidate Information"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Candidate name">
              <TextInput
                autoComplete="name"
                onChange={setCandidateName}
                placeholder="Jane Candidate"
                required
                value={candidateName}
              />
            </FormField>
            <FormField label="Candidate email">
              <div className="relative" ref={candidateLookupRef}>
                <TextInput
                  autoComplete="email"
                  onBlur={() => void resolveCandidateAccountByEmail(candidateEmail)}
                  onChange={(value) => {
                    setCandidateEmail(value);
                    if (
                      candidateUserId &&
                      value.trim().toLowerCase() !== selectedAccountEmail.toLowerCase()
                    ) {
                      setCandidateUserId("");
                      setSelectedAccountEmail("");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && accountMatches[0]) {
                      event.preventDefault();
                      selectCandidateAccount(accountMatches[0]);
                    }
                  }}
                  placeholder="Search registered account email"
                  required
                  type="email"
                  value={candidateEmail}
                />
                {accountMatches.length > 0 ? (
                  <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-lg">
                    {accountMatches.map((account) => (
                      <button
                        className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition hover:bg-slate-50"
                        key={account.id}
                        onClick={() => selectCandidateAccount(account)}
                        type="button"
                      >
                        <span className="text-sm font-semibold text-slate-900">{account.name}</span>
                        <span className="text-xs text-slate-500">{account.email}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {candidateUserId ? (
                <p className="mt-2 text-xs text-emerald-700">
                  Registered account selected. Email will be sent to {selectedAccountEmail}.
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  Start typing to select a registered User Portal account. Delivery uses that
                  account&apos;s email only.
                </p>
              )}
            </FormField>
          </div>
        </Panel>

        <Panel
          subtitle="Choose documents, set link expiration, and generate the secure request"
          title="Request Details"
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
            <div className="min-w-0">
              <p className="mb-3 text-sm font-semibold text-slate-700">Requested documents</p>
              <div className="relative sm:hidden" ref={documentMenuRef}>
                <button
                  aria-controls="mobile-document-options"
                  aria-expanded={isDocumentMenuOpen}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-blue-200 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  onClick={() => setIsDocumentMenuOpen((current) => !current)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">
                      {selectedDocuments.length
                        ? `${selectedDocuments.length} Document${
                            selectedDocuments.length === 1 ? "" : "s"
                          } Selected`
                        : "Select requested documents"}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Tap to add or remove document types
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
                      isDocumentMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isDocumentMenuOpen ? (
                  <div
                    className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 max-h-72 overflow-y-auto rounded-[20px] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-300/60"
                    id="mobile-document-options"
                    role="listbox"
                    aria-multiselectable="true"
                  >
                    {documentTypes.map((label) => {
                      const selected = selectedDocuments.includes(label);
                      return (
                        <button
                          aria-selected={selected}
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[16px] bg-transparent px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                          key={label}
                          onClick={() => toggleDocument(label)}
                          role="option"
                          type="button"
                        >
                          <span>{label}</span>
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border ${
                              selected
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-slate-300 bg-white text-transparent"
                            }`}
                          >
                            <Check className="h-4 w-4" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="hidden gap-3 sm:grid sm:grid-cols-2 2xl:grid-cols-3">
                {documentTypes.map((label) => {
                  const selected = selectedDocuments.includes(label);
                  return (
                    <button
                      key={label}
                      aria-pressed={selected}
                      className={`rounded-[20px] border px-4 py-3 text-left text-sm font-semibold transition ${
                        selected
                          ? "border-blue-300 bg-blue-50 text-blue-800"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                      onClick={() => toggleDocument(label)}
                      type="button"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <TextInput
                  onChange={setCustomDocument}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCustomDocument();
                    }
                  }}
                  placeholder="Add custom document request"
                  value={customDocument}
                />
                <SecondaryButton
                  className="w-full shrink-0 whitespace-nowrap sm:w-auto"
                  disabled={!customDocument.trim()}
                  onClick={addCustomDocument}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add custom
                  </span>
                </SecondaryButton>
              </div>

              {customDocuments.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {customDocuments.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
                    >
                      {label}
                      <button
                        aria-label={`Remove ${label}`}
                        onClick={() => removeCustomDocument(label)}
                        type="button"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <aside className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 xl:sticky xl:top-24">
              <h3 className="text-base font-bold text-slate-950">Request settings</h3>
              <div className="mt-4">
                <FormField label="Link expiration">
                  <DropdownSelect
                    onChange={setExpiryHours}
                    options={[
                      ...expiryHourOptions.map((hours) => ({
                        label: `${hours} ${hours === 1 ? "Hour" : "Hours"}${
                          hours === defaultExpiryHours ? " (Default)" : ""
                        }`,
                        value: String(hours),
                      })),
                      { label: "Custom Date & Time", value: "custom" },
                    ]}
                    value={expiryHours}
                  />
                </FormField>
              </div>
              {expiryHours === "custom" ? (
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-slate-700">Custom expiration</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-blue-300"
                    min={minimumCustomExpiry}
                    onChange={(event) => setCustomExpiresAt(event.target.value)}
                    required
                    type="datetime-local"
                    value={customExpiresAt}
                  />
                </label>
              ) : null}

              <div className="my-4 h-px bg-slate-200" />
              <p className="text-sm font-medium text-slate-600">
                {selectedDocuments.length + customDocuments.length
                  ? `${selectedDocuments.length + customDocuments.length} document${
                      selectedDocuments.length + customDocuments.length === 1 ? "" : "s"
                    } selected`
                  : "Choose at least one document."}
              </p>

              {error ? (
                <div className="mt-4 space-y-3 rounded-[20px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <p className="font-semibold">{error}</p>
                  {requestLink ? (
                    <p className="break-all text-red-600/90">
                      Secure link (share manually until email is configured):
                      <br />
                      {requestLink}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {message ? (
                <div className="mt-4 rounded-[20px] border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-800">{message}</p>
                      {requestLink ? (
                        <p className="mt-2 break-all text-sm text-emerald-700">{requestLink}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <PrimaryButton className="mt-5 w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Sending request..." : "Send Request"}
              </PrimaryButton>
              {createdRequestId && error ? (
                <SecondaryButton
                  className="mt-3 w-full"
                  onClick={() => void handleResendEmail()}
                  type="button"
                >
                  Resend email
                </SecondaryButton>
              ) : null}
              {requestLink ? (
                <SecondaryButton
                  className="mt-3 w-full"
                  onClick={() => void navigator.clipboard.writeText(requestLink)}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <Copy className="h-4 w-4" />
                    Copy link
                  </span>
                </SecondaryButton>
              ) : null}
            </aside>
          </div>
        </Panel>
      </form>
    </div>
  );
}
