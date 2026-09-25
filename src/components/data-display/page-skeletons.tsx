import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonToolbar() {
  return (
    <div className="flex flex-col gap-2 border-b border-border/70 py-3 sm:flex-row">
      <Skeleton className="h-11 flex-1 rounded-full sm:h-9 sm:max-w-sm" />
      <div className="flex gap-2 sm:ml-auto">
        <Skeleton className="h-11 w-28 rounded-full sm:h-9" />
        <Skeleton className="h-11 w-32 rounded-full sm:h-9" />
      </div>
    </div>
  );
}

export function KanbanPageSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-var(--app-chrome-top)-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col px-4 py-4 lg:h-[calc(100dvh-var(--app-chrome-top))] lg:px-6">
      <div className="flex items-center justify-between gap-4 border-b border-border/70 pb-4">
        <div className="space-y-2"><Skeleton className="h-7 w-32" /><Skeleton className="h-4 w-56" /></div>
        <Skeleton className="h-9 w-32 rounded-full" />
      </div>
      <SkeletonToolbar />
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden pt-3">
        {Array.from({ length: 4 }).map((_, column) => (
          <div key={column} className="w-72 shrink-0 rounded-lg border border-border/70 p-3">
            <Skeleton className="mb-4 h-5 w-28" />
            <div className="space-y-2">
              {Array.from({ length: column === 0 ? 4 : 3 }).map((__, card) => (
                <Skeleton key={card} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListPageSkeleton() {
  return (
    <main className="px-4 py-4 lg:px-6">
      <div className="flex items-center justify-between border-b border-border/70 pb-4">
        <div className="space-y-2"><Skeleton className="h-7 w-36" /><Skeleton className="h-4 w-64" /></div>
        <Skeleton className="h-9 w-36 rounded-full" />
      </div>
      <SkeletonToolbar />
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: 7 }).map((_, row) => (
          <div key={row} className="grid grid-cols-4 gap-4 border-t border-border/60 p-4">
            <Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" /><Skeleton className="ml-auto h-5 w-8" />
          </div>
        ))}
      </div>
    </main>
  );
}
