"use client";

import {
  ArrowDownUp,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  ListFilter,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CreateRequestCta,
  DropdownSelect,
  PageHeader,
  Panel,
  SecondaryButton,
  StatusBadge,
  TextInput,
  useHeaderSearch,
} from "@/components/hr-shell";
import { getCachedData, setCachedData } from "@/lib/client-cache";
import { withBasePath } from "@/lib/base-path";
import {
  CandidateCardSkeleton,
  CandidateTableRowSkeleton,
} from "@/components/skeletons";
import { formatDate, formatStatus, type RequestStatus } from "@/lib/hr-data";

type CandidateRequest = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: RequestStatus;
  createdAt: string;
  expiresAt: string;
  submittedAt?: string;
  completedAt?: string;
  items: Array<{
    id?: string;
    documentLabel: string;
    submittedDocumentId?: string;
    submittedFileName?: string;
  }>;
  emailStatus?: "sent" | "failed" | "unconfigured";
};

type CandidateCachePayload = {
  requests: CandidateRequest[];
  total: number;
};

function candidateCacheKey(input: {
  page: number;
  pageSize: number;
  search: string;
  sortBy: string;
  sortDirection: string;
  status: string;
}) {
  return `candidates:${input.page}:${input.pageSize}:${input.sortBy}:${input.sortDirection}:${input.status}:${input.search.trim().toLowerCase()}`;
}

export default function CandidatesPage() {
  const searchParams = useSearchParams();
  const { internalQuery, mode, setInternalQuery, setMode } = useHeaderSearch();
  const initialSearch = searchParams.get("search") || "";
  const initialStatus = searchParams.get("status") || "all";
  const initialSortBy = searchParams.get("sortBy") || "requestDate";
  const initialSortDirection = searchParams.get("sortDirection") || "desc";
  const initialCache = getCachedData<CandidateCachePayload>(
    candidateCacheKey({
      page: 1,
      pageSize: 10,
      search: initialSearch,
      sortBy: initialSortBy,
      sortDirection: initialSortDirection,
      status: initialStatus,
    }),
  );
  const [requests, setRequests] = useState<CandidateRequest[]>(initialCache?.requests || []);
  const [total, setTotal] = useState(initialCache?.total || 0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!initialCache);
  const [showMobileFab, setShowMobileFab] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const candidateListRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<CandidateRequest | null>(null);

  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortDirection, setSortDirection] = useState(initialSortDirection);
  const [pageSize, setPageSize] = useState(10);
  const searchRef = useRef(search);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadCandidates = useCallback(async () => {
    const cacheKey = candidateCacheKey({
      page,
      pageSize,
      search: debouncedSearch,
      sortBy,
      sortDirection,
      status,
    });
    const cached = getCachedData<CandidateCachePayload>(cacheKey);
    if (cached) {
      setRequests(cached.requests);
      setTotal(cached.total);
      setLoading(false);
    } else {
      setRequests([]);
      setTotal(0);
      setLoading(true);
    }

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortDirection,
      status,
    });

    if (debouncedSearch.trim()) {
      params.set("search", debouncedSearch.trim());
    }

    const response = await fetch(withBasePath(`/api/candidates?${params.toString()}`), {
      credentials: "include",
    });
    const data = (await response.json()) as {
      ok: boolean;
      requests?: CandidateRequest[];
      total?: number;
      message?: string;
    };

    if (!response.ok) {
      setError(data.message || "Unable to load candidates.");
      setLoading(false);
      return;
    }

    const nextPayload = {
      requests: data.requests || [],
      total: data.total || 0,
    };
    setRequests(nextPayload.requests);
    setTotal(nextPayload.total);
    setCachedData(cacheKey, nextPayload);
    setError("");
    setLoading(false);
  }, [debouncedSearch, page, pageSize, sortBy, sortDirection, status]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setPortalReady(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadCandidates();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadCandidates]);

  useEffect(() => {
    const requestedId = searchParams.get("request");
    const matchingRequest = requestedId
      ? requests.find((request) => request.id === requestedId)
      : undefined;
    if (!matchingRequest) {
      return;
    }

    const timeoutId = window.setTimeout(() => setSelectedRequest(matchingRequest), 0);
    return () => window.clearTimeout(timeoutId);
  }, [requests, searchParams]);

  useEffect(() => {
    if (mode !== "requests" || internalQuery === search) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSearch(internalQuery);
      setPage(1);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [internalQuery, mode, search]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    function applyMobilePageSize() {
      setPageSize(mediaQuery.matches ? 100 : 10);
      setPage(1);
    }

    const initialCheck = window.setTimeout(applyMobilePageSize, 0);
    mediaQuery.addEventListener("change", applyMobilePageSize);
    return () => {
      window.clearTimeout(initialCheck);
      mediaQuery.removeEventListener("change", applyMobilePageSize);
    };
  }, []);

  useEffect(() => {
    let requestModeActive = false;

    function updateFabVisibility() {
      const listTop = candidateListRef.current?.getBoundingClientRect().top;
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      const listReached =
        isMobile &&
        typeof listTop === "number" &&
        listTop <= window.innerHeight * 0.75 &&
        window.scrollY > 120;
      setShowMobileFab(listReached);

      if (listReached && !requestModeActive) {
        requestModeActive = true;
        setInternalQuery(searchRef.current);
        setMode("requests");
      } else if (!listReached && requestModeActive) {
        requestModeActive = false;
        setMode("global");
      }
    }

    const initialCheck = window.setTimeout(updateFabVisibility, 0);
    window.addEventListener("scroll", updateFabVisibility, { passive: true });
    window.addEventListener("resize", updateFabVisibility);
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener("scroll", updateFabVisibility);
      window.removeEventListener("resize", updateFabVisibility);
      setMode("global");
    };
  }, [setInternalQuery, setMode]);

  const statusOptions = useMemo(
    () => [
      { label: "All Status", value: "all" },
      { label: "Pending", value: "pending" },
      { label: "Submitted", value: "submitted" },
      { label: "Expired", value: "expired" },
    ],
    [],
  );

  async function handleComplete(id: string) {
    const response = await fetch(withBasePath(`/api/requests/${id}`), {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    const data = (await response.json()) as { ok: boolean; message: string };
    if (!response.ok || !data.ok) {
      setError(data.message);
      return;
    }

    setMessage(data.message);
    setSelectedRequest(null);
    await loadCandidates();
  }

  const mobileFabVisible = showMobileFab && !selectedRequest;

  return (
    <div className="careervault-screen-enter space-y-6">
      <PageHeader
        action={<CreateRequestCta />}
        eyebrow="Candidates"
        subtitle="Track every document request sent to candidates, monitor status, and manage active links."
        title="Candidate Requests"
      />

      {message ? (
        <p className="rounded-[20px] bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>
      ) : null}
      {error ? (
        <p className="rounded-[20px] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <Panel subtitle="Search and filters update automatically as values change" title="All Requests">
        <div className="sticky top-14 z-20 -mx-2 grid grid-cols-3 gap-2 bg-white/95 px-2 py-3 backdrop-blur md:hidden">
          <CompactFilterSelect
            active={status !== "all"}
            icon={<ListFilter className="h-4 w-4" />}
            label={status === "all" ? "Status" : formatStatus(status as RequestStatus)}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={statusOptions}
            value={status}
          />
          <CompactFilterSelect
            active={sortBy !== "requestDate"}
            icon={<CalendarDays className="h-4 w-4" />}
            label={sortBy === "requestDate" ? "Date" : sortBy === "name" ? "Name" : "Expiry"}
            onChange={(value) => {
              setSortBy(value);
              setPage(1);
            }}
            options={[
              { label: "Request date", value: "requestDate" },
              { label: "Candidate name", value: "name" },
              { label: "Expiry date", value: "expiryDate" },
            ]}
            value={sortBy}
          />
          <CompactFilterSelect
            active={sortDirection !== "desc"}
            icon={<ArrowDownUp className="h-4 w-4" />}
            label={sortDirection === "desc" ? "Newest" : "Oldest"}
            onChange={(value) => {
              setSortDirection(value);
              setPage(1);
            }}
            options={[
              { label: "Newest first", value: "desc" },
              { label: "Oldest first", value: "asc" },
            ]}
            value={sortDirection}
          />
        </div>

        <div className="hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-4">
          <FilterField className="lg:col-span-1" label="Search">
            <TextInput
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Name, email, or candidate ID"
              value={search}
            />
          </FilterField>
          <FilterField label="Status">
            <DropdownSelect
              icon={<ListFilter className="h-4 w-4" />}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={statusOptions}
              value={status}
            />
          </FilterField>
          <FilterField label="Sort by">
            <DropdownSelect
              icon={<CalendarDays className="h-4 w-4" />}
              onChange={(value) => {
                setSortBy(value);
                setPage(1);
              }}
              options={[
                { label: "Request date", value: "requestDate" },
                { label: "Candidate name", value: "name" },
                { label: "Expiry date", value: "expiryDate" },
              ]}
              value={sortBy}
            />
          </FilterField>
          <FilterField label="Order">
            <DropdownSelect
              icon={<ArrowDownUp className="h-4 w-4" />}
              onChange={(value) => {
                setSortDirection(value);
                setPage(1);
              }}
              options={[
                { label: "Newest first", value: "desc" },
                { label: "Oldest first", value: "asc" },
              ]}
              value={sortDirection}
            />
          </FilterField>
        </div>

        <div className="mt-5 space-y-3 md:hidden" ref={candidateListRef}>
          {loading && !requests.length ? <MobileCandidateSkeleton /> : null}
          {requests.map((request) => (
            <article
              className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm transition active:scale-[0.99]"
              key={request.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-bold text-slate-950">{request.candidateName}</h3>
                  <p className="mt-1 truncate text-sm text-slate-500">{request.candidateEmail}</p>
                </div>
                <div className="shrink-0">
                  <StatusBadge status={formatStatus(request.status)} />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-slate-100 py-4">
                <MobileDetail label="Requested" value={formatDate(request.createdAt)} />
                <MobileDetail label="Expires" value={formatDate(request.expiresAt)} />
                <MobileDetail label="Request ID" value={request.id.slice(0, 8).toUpperCase()} />
                <MobileDetail
                  label="Documents"
                  value={`${request.items.length} requested`}
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {request.emailStatus === "failed" || request.emailStatus === "unconfigured"
                    ? "Email delivery needs attention"
                    : "Document request"}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    aria-label={`View request for ${request.candidateName}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 active:scale-90"
                    onClick={() => setSelectedRequest(request)}
                    title="View request"
                    type="button"
                  >
                    <Eye className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div
          className={`mt-6 hidden overflow-auto rounded-[20px] border border-slate-200 md:block ${
            total > 10 ? "h-[640px]" : ""
          }`}
        >
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                {["Candidate", "Request Date", "Expiry Date", "Status", "Actions"].map((heading) => (
                  <th
                    key={heading}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {loading && !requests.length ? <CandidateTableSkeleton /> : null}
              {requests.map((request) => (
                <tr key={request.id} className="hover:bg-slate-50/80">
                  <td className="max-w-[280px] px-4 py-3">
                    <p className="truncate font-semibold text-slate-900" title={request.candidateName}>
                      {request.candidateName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500" title={request.candidateEmail}>
                      {request.candidateEmail}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600" title={formatDate(request.createdAt)}>
                    {formatDate(request.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600" title={formatDate(request.expiresAt)}>
                    {formatDate(request.expiresAt)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={formatStatus(request.status)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ActionButton
                        icon={<Eye className="h-4 w-4" />}
                        label="View"
                        onClick={() => setSelectedRequest(request)}
                      />
                      {request.status === "submitted" && !request.completedAt ? (
                        <ActionButton
                          icon={<CheckCircle2 className="h-4 w-4" />}
                          label="Complete"
                          onClick={() => void handleComplete(request.id)}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !requests.length ? (
          <p className="mt-4 text-sm text-slate-500">No candidate requests match your filters.</p>
        ) : null}

        <div className="mt-4 hidden flex-col gap-4 md:flex lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center">
            <p>
              {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} of {total}
            </p>
            <label className="flex items-center gap-2">
              <span className="whitespace-nowrap">Rows per page</span>
              <select
                aria-label="Rows per page"
                className="h-10 rounded-[16px] border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                value={pageSize}
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Previous
            </SecondaryButton>
            <span className="px-2 text-sm font-medium text-slate-600">
              Page {page} of {totalPages}
            </span>
            <SecondaryButton
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </SecondaryButton>
          </div>
        </div>
      </Panel>

      {portalReady
        ? createPortal(
            <Link
              aria-hidden={!mobileFabVisible}
              aria-label="Create a new request"
              className={`fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] right-[max(1rem,env(safe-area-inset-right,0px))] z-[60] flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.35)] transition-all duration-300 before:absolute before:inset-0 before:scale-0 before:rounded-full before:bg-white/25 before:transition-transform before:duration-300 hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 active:scale-90 active:before:scale-100 md:hidden ${
                mobileFabVisible
                  ? "pointer-events-auto translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-4 opacity-0"
              }`}
              href="/requests"
              tabIndex={mobileFabVisible ? 0 : -1}
            >
              <Plus className="relative h-6 w-6" />
            </Link>,
            document.body,
          )
        : null}

      {selectedRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[20px] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                  Request details
                </p>
                <h2 className="mt-2 text-2xl font-bold text-slate-950">
                  {selectedRequest.candidateName}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{selectedRequest.candidateEmail}</p>
              </div>
              <button
                className="rounded-[20px] border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                onClick={() => setSelectedRequest(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Detail label="Status" value={formatStatus(selectedRequest.status)} />
              <Detail label="Request date" value={formatDate(selectedRequest.createdAt)} />
              <Detail label="Expiry date" value={formatDate(selectedRequest.expiresAt)} />
              <Detail
                label="Documents"
                value={`${selectedRequest.items.length} requested`}
              />
            </div>

            <div className="mt-6">
              <p className="text-sm font-semibold text-slate-700">Requested documents</p>
              <ul className="mt-3 space-y-2">
                {selectedRequest.items.map((item) => (
                  <li
                    key={item.id || item.documentLabel}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                  >
                    <span>
                      {item.documentLabel}
                      {item.submittedFileName ? (
                        <span className="ml-2 text-xs text-slate-500">
                          {item.submittedFileName}
                        </span>
                      ) : null}
                    </span>
                    {item.submittedDocumentId ? (
                      <span className="flex flex-wrap gap-2">
                        {canPreview(item.submittedFileName) ? (
                          <a
                            className="inline-flex h-9 items-center gap-2 rounded-[20px] border border-slate-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                            href={withBasePath(
                              `/api/requests/${selectedRequest.id}/download?fileId=${encodeURIComponent(item.submittedDocumentId)}&preview=1`,
                            )}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <Eye className="h-4 w-4" />
                            Preview
                          </a>
                        ) : null}
                        <a
                          className="inline-flex h-9 items-center gap-2 rounded-[20px] border border-slate-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                          href={withBasePath(
                            `/api/requests/${selectedRequest.id}/download?fileId=${encodeURIComponent(item.submittedDocumentId)}`,
                          )}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </a>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            {selectedRequest.status === "submitted" && !selectedRequest.completedAt ? (
              <button
                className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[20px] bg-emerald-600 px-5 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-100 active:scale-[0.98] sm:w-auto"
                onClick={() => void handleComplete(selectedRequest.id)}
                type="button"
              >
                <CheckCircle2 className="h-4 w-4" />
                Mark complete
              </button>
            ) : null}

          </div>
        </div>
      ) : null}
    </div>
  );
}

function canPreview(fileName?: string) {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  return Boolean(extension && ["pdf", "jpg", "jpeg", "png"].includes(extension));
}

function MobileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-slate-700">{value}</p>
    </div>
  );
}

function MobileCandidateSkeleton() {
  return (
    <>
      {[0, 1, 2].map((item) => (
        <CandidateCardSkeleton key={item} />
      ))}
    </>
  );
}

function CandidateTableSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <CandidateTableRowSkeleton key={index} />
      ))}
    </>
  );
}

function CompactFilterSelect({
  active,
  icon,
  label,
  onChange,
  options,
  value,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label
      className={`relative flex h-11 min-w-0 items-center justify-center gap-1 rounded-[16px] border px-2 transition ${
        active
          ? "border-blue-200 bg-blue-50 text-blue-700 shadow-sm"
          : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate text-[11px] font-semibold">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      <select
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterField({
  children,
  className = "",
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center gap-2 rounded-[20px] border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700"
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
