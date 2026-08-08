"use client";

import { useEffect, useState } from "react";

const loadingRevealDelayMs = 0;

export function useDelayedLoading(isLoading: boolean) {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      const resetId = window.setTimeout(() => setShowLoading(false), 0);
      return () => window.clearTimeout(resetId);
    }

    const timeoutId = window.setTimeout(() => {
      setShowLoading(true);
    }, loadingRevealDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [isLoading]);

  return isLoading && showLoading;
}

export function ShimmerBlock({ className = "" }: { className?: string }) {
  return <div className={`careervault-shimmer ${className}`.trim()} />;
}

export function StatCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-200/50"
    >
      <ShimmerBlock className="h-10 w-10 rounded-[20px]" />
      <ShimmerBlock className="mt-5 h-4 w-28" />
      <ShimmerBlock className="mt-2 h-8 w-14" />
    </div>
  );
}

export function DashboardHeroSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white p-7 shadow-xl shadow-slate-200/60 sm:p-8"
    >
      <ShimmerBlock className="h-10 w-3/4 max-w-md" />
      <ShimmerBlock className="mt-4 h-4 w-full max-w-xl" />
      <ShimmerBlock className="mt-2 h-4 w-2/3 max-w-lg" />
      <ShimmerBlock className="mt-6 h-12 w-44 rounded-[20px]" />
    </section>
  );
}

export function DashboardPanelSkeleton({ rows }: { rows: number }) {
  return (
    <section
      aria-hidden="true"
      className="rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60"
    >
      <ShimmerBlock className="h-6 w-40" />
      <ShimmerBlock className="mt-2 h-4 w-56" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <ActivityItemSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

export function ActivityItemSkeleton() {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <ShimmerBlock className="h-4 w-36" />
          <ShimmerBlock className="h-3.5 w-48" />
        </div>
        <ShimmerBlock className="h-6 w-20 rounded-full" />
      </div>
      <ShimmerBlock className="mt-3 h-3.5 w-2/3 max-w-xs" />
      <ShimmerBlock className="mt-2 h-3 w-28" />
    </div>
  );
}

export function DashboardScreenSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard"
      className="careervault-screen-enter space-y-6"
      role="status"
    >
      <span className="sr-only">Loading dashboard</span>
      <DashboardHeroSkeleton />
      <section className="grid gap-4 md:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </section>
      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
        <DashboardPanelSkeleton rows={3} />
        <DashboardPanelSkeleton rows={4} />
      </section>
    </div>
  );
}

export function CandidateCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <ShimmerBlock className="h-5 w-[58%] max-w-[180px]" />
        <ShimmerBlock className="h-6 w-16 rounded-full" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index}>
            <ShimmerBlock className="h-3 w-16" />
            <ShimmerBlock className="mt-2 h-4 w-full" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <ShimmerBlock className="h-9 w-9 rounded-[20px]" key={index} />
        ))}
      </div>
    </article>
  );
}

export function CandidateTableRowSkeleton() {
  return (
    <tr aria-hidden="true">
      <td className="px-4 py-3">
        <ShimmerBlock className="h-4 w-32" />
        <ShimmerBlock className="mt-2 h-3 w-44" />
      </td>
      {[0, 1, 2].map((cell) => (
        <td className="px-4 py-3" key={cell}>
          <ShimmerBlock className="h-4 w-24" />
        </td>
      ))}
      <td className="px-4 py-3">
        <ShimmerBlock className="h-9 w-20 rounded-[20px]" />
      </td>
    </tr>
  );
}
