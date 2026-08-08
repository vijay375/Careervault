"use client";

import {
  Activity,
  Clock3,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CreateRequestCta,
  Panel,
  StatCard,
  StatusBadge,
  useHrUser,
} from "@/components/hr-shell";
import {
  DashboardScreenSkeleton,
  useDelayedLoading,
} from "@/components/skeletons";
import { getCachedData, setCachedData } from "@/lib/client-cache";
import { withBasePath } from "@/lib/base-path";
import { formatDate, formatStatus, type RequestStatus } from "@/lib/hr-data";

type DashboardStats = {
  total: number;
  pending: number;
  submitted: number;
  expired: number;
  active: number;
  recentActivity: Array<{
    id: string;
    candidateName: string;
    candidateEmail: string;
    status: RequestStatus;
    createdAt: string;
    items: Array<{ documentLabel: string }>;
  }>;
};

export default function DashboardPage() {
  const user = useHrUser();
  const [stats, setStats] = useState<DashboardStats | null>(
    () => getCachedData<DashboardStats>("dashboard") || null,
  );
  const [loading, setLoading] = useState(() => !getCachedData<DashboardStats>("dashboard"));
  const [error, setError] = useState("");
  const firstName = String(user.firstName || user.name || "").trim().split(/\s+/)[0] || "there";
  const isInitialLoading = loading && !stats;
  const showSkeleton = useDelayedLoading(isInitialLoading);

  useEffect(() => {
    void (async () => {
      const response = await fetch(withBasePath("/api/dashboard"), {
        credentials: "include",
      });
      const data = (await response.json()) as {
        ok: boolean;
        stats?: DashboardStats;
        message?: string;
      };

      if (!response.ok || !data.stats) {
        setError(data.message || "Unable to load dashboard.");
        setLoading(false);
        return;
      }

      setStats(data.stats);
      setCachedData("dashboard", data.stats);
      setLoading(false);
    })();
  }, []);

  if (isInitialLoading && !showSkeleton) {
    return <div aria-hidden="true" className="min-h-[720px]" />;
  }

  if (showSkeleton) {
    return <DashboardScreenSkeleton />;
  }

  return (
    <div className="careervault-fade-in space-y-6">
      <section className="relative overflow-hidden rounded-[20px] bg-[radial-gradient(circle_at_18%_10%,rgba(96,165,250,0.4),transparent_28%),linear-gradient(135deg,#101a3a_0%,#123fba_48%,#2f9ef5_100%)] p-7 text-white shadow-2xl shadow-blue-900/15 sm:p-8">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute bottom-0 right-24 h-28 w-28 rounded-full bg-cyan-300/20 blur-xl" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Welcome back, {firstName}
            </h1>
            <h2 className="mt-3 max-w-2xl text-sm font-medium leading-6 text-blue-50 sm:text-base">
              Collect candidate documents faster.
            </h2>
          </div>
          <CreateRequestCta variant="inverse" />
        </div>
      </section>

      {error ? (
        <p className="rounded-[20px] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Send className="h-5 w-5" />}
          label="Total Requests"
          value={String(stats?.total ?? "—")}
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" />}
          label="Pending Requests"
          value={String(stats?.pending ?? "—")}
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="Completion Rate"
          value={
            stats
              ? `${stats.total ? Math.round((stats.submitted / stats.total) * 100) : 0}%`
              : "—"
          }
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
        <Panel
          action={
            <Link
              className="inline-flex text-sm font-semibold text-blue-700 transition hover:text-blue-800"
              href="/candidates"
            >
              View All
            </Link>
          }
          subtitle="Latest candidate document requests"
          title="Recent Activity"
        >
          <div className="max-h-[388px] space-y-3 overflow-y-auto pr-1">
            {(stats?.recentActivity || []).slice(0, 5).map((request) => (
              <article
                key={request.id}
                className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{request.candidateName}</p>
                    <p className="text-sm text-slate-500">{request.candidateEmail}</p>
                  </div>
                  <StatusBadge status={formatStatus(request.status)} />
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {request.items.map((item) => item.documentLabel).join(", ")}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Requested {formatDate(request.createdAt)}
                </p>
              </article>
            ))}
            {!stats?.recentActivity.length ? (
              <p className="text-sm text-slate-500">
                No requests yet. Create your first request to get started.
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel subtitle="Quick actions for HR teams" title="Summary">
          <div className="max-h-[388px] overflow-y-auto pr-1">
            <div className="rounded-[20px] border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">Review candidates</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Track pending, submitted, and expired requests from one table.
              </p>
              <Link
                className="mt-4 inline-flex text-sm font-semibold text-blue-700 hover:text-blue-800"
                href="/candidates"
              >
                Open candidates
              </Link>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
