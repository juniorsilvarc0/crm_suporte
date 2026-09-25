import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    // Espelha a geometria da página real: cartão flutuante com a mesma folga,
    // senão o esqueleto nasce colado nas bordas e a tela "pula" ao hidratar.
    <div className="flex h-[calc(100dvh-var(--app-chrome-top)-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col p-2 sm:p-3 lg:h-[calc(100dvh-var(--app-chrome-top))] lg:px-4 lg:pb-4">
      <div className="panel-float flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Faixa de controles: duas linhas, como a AgendaToolbar real. */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 px-3 py-2 sm:py-2.5 lg:px-4">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-11 w-16 shrink-0 rounded-full sm:h-9" />
          <Skeleton className="size-11 shrink-0 rounded-full sm:size-9" />
          <Skeleton className="size-11 shrink-0 rounded-full sm:size-9" />
          <Skeleton className="ml-1 h-6 w-36 sm:w-48" />
          <Skeleton className="ml-auto h-11 w-11 shrink-0 rounded-full sm:h-9 sm:w-28" />
        </div>
        <div className="flex items-center gap-2 sm:justify-between">
          <Skeleton className="h-11 flex-1 rounded-full sm:h-9 sm:w-72 sm:flex-none" />
          <Skeleton className="h-11 w-11 shrink-0 rounded-full sm:h-9 sm:w-44" />
        </div>
      </div>

      {/* Busca, filtros e contagem: uma linha só. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2 lg:px-4">
        <Skeleton className="h-11 min-w-0 flex-1 rounded-full sm:h-9 sm:max-w-xs" />
        <Skeleton className="h-11 w-20 shrink-0 rounded-full sm:h-9" />
        <Skeleton className="h-4 w-8 shrink-0 sm:w-28" />
        <Skeleton className="size-11 shrink-0 rounded-full sm:size-9" />
      </div>

      <div className="grid shrink-0 grid-cols-7 border-b border-border/70 px-2 py-2">
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="mx-auto h-3 w-8" />)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-5 gap-px bg-border/60">
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} className="bg-card p-2">
            <Skeleton className="size-6 rounded-full" />
            {index % 3 === 0 ? <Skeleton className="mt-2 h-8 w-full rounded-lg" /> : null}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
