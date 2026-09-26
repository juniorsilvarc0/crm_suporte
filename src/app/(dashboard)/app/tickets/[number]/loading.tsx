import { Skeleton } from "@/components/ui/skeleton";
import { TicketTimelineSkeleton } from "@/features/tickets/components/ticket-timeline";

// Geometria do detalhe (ticket-detail.tsx): voltar, protocolo, título, selos,
// fatos e ações; e a grade — descrição e timeline à esquerda, a lateral de
// fatos e os anexos à direita.
export default function TicketLoading() {
  return (
    <main
      className="mx-auto w-full max-w-screen-xl space-y-6 p-4 sm:p-6 lg:space-y-8 lg:p-8"
      aria-label="Carregando ticket"
    >
      <div className="space-y-3">
        <Skeleton className="h-5 w-20" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-96 max-w-full" />
            <div className="flex flex-wrap gap-2 pt-1">
              <Skeleton className="h-5 w-28 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-32 rounded-full" />
            </div>
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-full rounded-full sm:h-9 sm:w-52" />
            <Skeleton className="h-11 flex-1 rounded-full sm:h-9 sm:w-24 sm:flex-none" />
            <Skeleton className="size-11 rounded-full sm:size-9" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <div className="space-y-3">
            <Skeleton className="h-3 w-20" />
            <div className="space-y-2 rounded-xl border border-border/60 bg-card p-4 shadow-soft">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-3 w-28" />
            <TicketTimelineSkeleton />
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-3 w-16" />
            <div className="grid gap-4 rounded-xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-40 max-w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-11 w-36 rounded-full sm:h-8" />
          </div>
        </div>
      </div>
    </main>
  );
}
