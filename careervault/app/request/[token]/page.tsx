"use client";

import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  FileText,
  LoaderCircle,
  LogIn,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { documentTypes, formatDate } from "@/lib/careervault-data";

type RequestItem = {
  id: string;
  documentLabel: string;
  isCustom: boolean;
};

type RequestPayload = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: "pending" | "submitted" | "expired";
  expiresAt: string;
  submittedAt?: string;
  items: RequestItem[];
};

type VaultDocument = {
  id: string;
  fileName: string;
  documentType: string;
  companyName: string;
  uploadedAt: string;
  fileUrl?: string;
};

type ItemSelection = {
  mode: "vault" | "upload";
  documentId?: string;
  fileName?: string;
  pendingFile?: File;
};

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "employee" | "recruiter";
};

const allowedExtensions = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];

export default function DocumentRequestPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [request, setRequest] = useState<RequestPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [selections, setSelections] = useState<Record<string, ItemSelection>>({});
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const progressMarkedRef = useRef(false);

  const loadRequest = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const response = await fetch(`/api/requests/${token}`);
      const data = (await response.json()) as {
        ok: boolean;
        message?: string;
        request?: RequestPayload;
      };

      if (!response.ok || !data.request) {
        setLoadError(data.message || "Unable to load this request.");
        setRequest(null);
        return;
      }

      setRequest(data.request);
    } catch {
      setLoadError("Unable to load this request. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const restoreSession = useCallback(async () => {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    if (!response.ok) {
      setUser(null);
      return;
    }

    const data = (await response.json()) as { ok: boolean; user?: SessionUser };
    if (data.user) {
      if (data.user.role === "recruiter") {
        window.location.replace(process.env.NEXT_PUBLIC_HR_PORTAL_URL || "http://localhost:3001");
        return;
      }
      setUser(data.user);
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/documents", { credentials: "include" });
    if (!response.ok) {
      setDocuments([]);
      return;
    }

    const data = (await response.json()) as { ok: boolean; documents?: VaultDocument[] };
    setDocuments(data.documents || []);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadRequest();
      void restoreSession();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadRequest, restoreSession]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (user) {
        void loadDocuments();
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [user, loadDocuments]);

  const emailMatches = useMemo(() => {
    if (!user || !request) {
      return true;
    }

    return user.email.toLowerCase() === request.candidateEmail.toLowerCase();
  }, [request, user]);

  const canInteract =
    request &&
    request.status === "pending" &&
    user &&
    emailMatches &&
    new Date(request.expiresAt) > new Date();

  async function markInProgress() {
    if (progressMarkedRef.current || !user || !emailMatches) {
      return;
    }

    progressMarkedRef.current = true;
    const response = await fetch(`/api/requests/${token}/progress`, {
      method: "POST",
      credentials: "include",
    });
    if (response.ok) {
      setRequest((current) => (current ? { ...current, status: "pending" } : current));
    } else {
      progressMarkedRef.current = false;
    }
  }

  async function uploadPendingFile(file: File, metadata: {
    documentType: string;
    companyName: string;
    employeeName: string;
    designation: string;
    joiningDate: string;
  }) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append(
      "metadata",
      JSON.stringify({
        companyName: metadata.companyName,
        employeeName: metadata.employeeName,
        designation: metadata.designation,
        joiningDate: metadata.joiningDate,
        documentType: metadata.documentType,
        fileName: file.name,
        fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        status: "Review needed",
        fileType: file.name.split(".").pop()?.toUpperCase() || "PDF",
        originalFileName: file.name,
      }),
    );

    const response = await fetch("/api/documents", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const data = (await response.json()) as { ok: boolean; document?: VaultDocument; message?: string };

    if (!response.ok || !data.document) {
      throw new Error(data.message || "Upload failed.");
    }

    await loadDocuments();
    return data.document;
  }

  function handleVaultSelect(itemId: string, documentId: string) {
    const document = documents.find((entry) => entry.id === documentId);
    setSelections((current) => ({
      ...current,
      [itemId]: {
        mode: "vault",
        documentId,
        fileName: document?.fileName,
      },
    }));
    if (documentId) {
      void markInProgress();
    }
  }

  function handleFilePick(itemId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowedExtensions.includes(extension)) {
      setSubmitError("Unsupported file type. Use PDF, DOC, DOCX, JPG, or PNG.");
      return;
    }

    setSelections((current) => ({
      ...current,
      [itemId]: {
        mode: "upload",
        pendingFile: file,
        fileName: file.name,
      },
    }));
    setSubmitError("");
    void markInProgress();
  }

  async function handleSubmit() {
    if (!request || !user) {
      return;
    }

    setSubmitError("");
    setSubmitMessage("");
    setIsSubmitting(true);

    try {
      const submissions: Array<{ itemId: string; documentId: string }> = [];

      for (const item of request.items) {
        const selection = selections[item.id];

        if (!selection) {
          setSubmitError(`Please provide ${item.documentLabel}.`);
          return;
        }

        if (selection.mode === "vault" && selection.documentId) {
          submissions.push({ itemId: item.id, documentId: selection.documentId });
          continue;
        }

        if (selection.mode === "upload" && selection.pendingFile) {
          const uploaded = await uploadPendingFile(selection.pendingFile, {
            documentType: item.documentLabel,
            companyName: "Pending Review",
            employeeName: request.candidateName,
            designation: "Candidate",
            joiningDate: new Date().toISOString().slice(0, 10),
          });
          submissions.push({ itemId: item.id, documentId: uploaded.id });
          continue;
        }

        setSubmitError(`Please provide ${item.documentLabel}.`);
        return;
      }

      const response = await fetch(`/api/requests/${token}/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissions }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        message: string;
        request?: RequestPayload;
      };

      if (!response.ok || !data.ok) {
        setSubmitError(data.message);
        return;
      }

      setSubmitMessage(data.message);
      if (data.request) {
        setRequest({
          ...request,
          status: data.request.status,
          submittedAt: data.request.submittedAt,
        });
      } else {
        await loadRequest();
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Submission failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <RequestShell>
        <div className="flex min-h-[420px] items-center justify-center">
          <LoaderCircle className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </RequestShell>
    );
  }

  if (loadError || !request) {
    return (
      <RequestShell>
        <StatusPanel
          icon={<AlertCircle className="h-8 w-8 text-red-600" />}
          title="Request unavailable"
          message={loadError || "This request link is invalid."}
        />
      </RequestShell>
    );
  }

  if (request.status === "expired") {
    return (
      <RequestShell>
        <StatusPanel
          icon={<AlertCircle className="h-8 w-8 text-amber-600" />}
          title="Link expired"
          message="This document request link has expired. Please contact HR to receive a new link."
        />
      </RequestShell>
    );
  }

  if (request.status === "submitted") {
    return (
      <RequestShell>
        <StatusPanel
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-600" />}
          title="Documents Submitted Successfully"
          message={`Your documents were submitted successfully${
            request.submittedAt ? ` on ${formatDate(request.submittedAt)}` : ""
          }. This link can no longer be used for uploads.`}
        />
      </RequestShell>
    );
  }

  return (
    <RequestShell>
      <section className="rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
          HR Document Request
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Hello, {request.candidateName}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Please submit the requested documents below. You can choose files from your CareerVault or
          upload new ones. Link expires on {formatDate(request.expiresAt)}.
        </p>
      </section>

      {!user ? (
        <section className="rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[20px] bg-blue-50 text-blue-700">
              <LogIn className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-950">Sign in to continue</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Sign in or create a CareerVault account with{" "}
                <span className="font-semibold text-slate-700">{request.candidateEmail}</span> to
                submit your documents securely.
              </p>
              <button
                className="mt-4 h-11 rounded-[20px] bg-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
                onClick={() =>
                  router.push(`/?returnTo=${encodeURIComponent(`/request/${token}`)}`)
                }
                type="button"
              >
                Sign in to CareerVault
              </button>
            </div>
          </div>
        </section>
      ) : !emailMatches ? (
        <section className="rounded-[20px] border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm font-semibold text-amber-900">Email mismatch</p>
          <p className="mt-2 text-sm leading-6 text-amber-800">
            You are signed in as {user.email}, but this request was sent to {request.candidateEmail}.
            Please sign in with the correct account.
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-4">
            {request.items.map((item) => {
              const selection = selections[item.id];
              const matchingDocuments = documents.filter(
                (document) =>
                  document.documentType === item.documentLabel ||
                  item.isCustom ||
                  documentTypes.includes(item.documentLabel as (typeof documentTypes)[number]),
              );

              return (
                <article
                  key={item.id}
                  className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[20px] bg-blue-50 text-blue-700">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-slate-950">{item.documentLabel}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Select from your vault or upload a new document.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700">From CareerVault</span>
                      <select
                        className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:border-blue-300"
                        onChange={(event) => handleVaultSelect(item.id, event.target.value)}
                        value={selection?.mode === "vault" ? selection.documentId || "" : ""}
                      >
                        <option value="">Choose a saved document</option>
                        {matchingDocuments.map((document) => (
                          <option key={document.id} value={document.id}>
                            {document.fileName} · {document.companyName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700">Upload new</span>
                      <div className="mt-2 flex h-11 items-center rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4">
                        <CloudUpload className="mr-2 h-4 w-4 text-slate-500" />
                        <input
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          className="w-full text-sm text-slate-600 file:mr-3 file:rounded-[20px] file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                          onChange={(event) => handleFilePick(item.id, event)}
                          type="file"
                        />
                      </div>
                    </label>
                  </div>

                  {selection?.fileName ? (
                    <p className="mt-3 text-sm font-medium text-emerald-700">
                      Selected: {selection.fileName}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </section>

          <section className="rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Review and submit</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Confirm all requested documents are attached before submitting. After submission, this
              link will be locked.
            </p>

            {submitError ? (
              <p className="mt-4 rounded-[20px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {submitError}
              </p>
            ) : null}
            {submitMessage ? (
              <p className="mt-4 rounded-[20px] bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                {submitMessage}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                className="h-11 rounded-[20px] bg-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canInteract || isSubmitting}
                onClick={() => void handleSubmit()}
                type="button"
              >
                {isSubmitting ? "Submitting..." : "Submit all documents"}
              </button>
              <button
                className="h-11 rounded-[20px] border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => router.push("/")}
                type="button"
              >
                Open CareerVault
              </button>
            </div>
          </section>
        </>
      )}

    </RequestShell>
  );
}

function RequestShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f6f8fb]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link className="flex items-center gap-3" href="/">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
              CV
            </span>
            <span className="text-lg font-bold text-slate-950">CareerVault</span>
          </Link>
          <Link className="text-sm font-semibold text-blue-700 hover:text-blue-800" href="/">
            Go to portal
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">{children}</div>
    </main>
  );
}

function StatusPanel({
  icon,
  message,
  title,
}: {
  icon: React.ReactNode;
  message: string;
  title: string;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-50">
        {icon}
      </div>
      <h1 className="mt-5 text-2xl font-bold text-slate-950">{title}</h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">{message}</p>
    </section>
  );
}
