export default function TicketsBoardLoading() {
  return (
    <main className="mx-auto w-full max-w-screen-2xl p-4 sm:p-6 lg:p-8">
      <div className="space-y-3">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-9 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="flex gap-4 overflow-hidden pt-2">
          {Array.from({ length: 4 }).map((_, column) => (
            <div
              key={column}
              className="h-96 w-[22rem] shrink-0 animate-pulse rounded-2xl border border-border/70 bg-muted/30"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
