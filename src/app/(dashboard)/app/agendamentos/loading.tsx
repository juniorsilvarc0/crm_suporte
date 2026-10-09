import { Skeleton } from "@/components/ui/skeleton";

export default function AgendaLoading() {
  return (
    // Mesma geometria da página: cartão flutuante na altura da tela, faixa de
    // duas linhas (AgendaToolbar) e a grade do mês — senão a tela pula ao chegar.
    <div className="flex h-[calc(100dvh-var(--app-chrome-top)-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col p-2 sm:p-3 lg:h-[calc(100dvh-var(--app-chrome-top))] lg:px-4 lg:pb-4">
      <div className="panel-float flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 px-3 py-2 sm:py-2.5 lg:px-4">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-11 w-16 shrink-0 rounded-md sm:h-9" />
            <Skeleton className="size-11 shrink-0 rounded-md sm:size-9" />
            <Skeleton className="size-11 shrink-0 rounded-md sm:size-9" />
            <Skeleton className="ml-1 h-6 w-36 sm:w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-11 flex-1 rounded-lg sm:h-9 sm:w-72 sm:flex-none" />
            <Skeleton className="ml-auto hidden h-4 w-28 sm:block" />
            <Skeleton className="h-11 w-11 shrink-0 rounded-md sm:h-9 sm:w-44" />
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-7 border-b border-border/70 px-2 py-2">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="mx-auto h-3 w-8" />
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-5 gap-px bg-border/60">
          {Array.from({ length: 35 }, (_, index) => (
            <div key={index} className="bg-card p-2">
              <Skeleton className="size-6 rounded-full" />
              {index % 3 === 0 ? <Skeleton className="mt-2 h-8 w-full rounded-md" /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
