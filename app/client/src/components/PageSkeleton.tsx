import React from 'react';

export default function PageSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-pulse">
      {/* Top Header Bar Skeleton */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-4 w-72 bg-slate-200/70 dark:bg-slate-800/70 rounded" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-28 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-9 w-32 bg-indigo-200 dark:bg-indigo-950/50 rounded-lg" />
        </div>
      </div>

      {/* KPI Stats Grid Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/50 dark:bg-slate-900/40 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
              <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-800" />
            </div>
            <div className="h-7 w-32 bg-slate-200 dark:bg-slate-800 rounded-md" />
            <div className="h-3 w-24 bg-slate-200/60 dark:bg-slate-850 rounded" />
          </div>
        ))}
      </div>

      {/* Main Content Card Skeleton */}
      <div className="p-6 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/50 dark:bg-slate-900/40 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
          <div className="h-5 w-40 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 rounded-lg" />
        </div>
        <div className="space-y-3 pt-2">
          {[1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center gap-4">
              <div className="h-4 w-1/4 bg-slate-200/80 dark:bg-slate-800/80 rounded" />
              <div className="h-4 w-1/3 bg-slate-200/60 dark:bg-slate-800/60 rounded" />
              <div className="h-4 w-1/6 bg-slate-200/50 dark:bg-slate-850 rounded" />
              <div className="h-4 w-1/6 bg-slate-200/70 dark:bg-slate-800/70 rounded ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
