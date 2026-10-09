import { Skeleton } from "@/components/ui/skeleton";

export default function MetricasLoading() {
  return (
    // Mesma geometria da página: cabeçalho com o período, a banda e o gráfico.
    <main className="mx-auto w-full max-w-screen-xl space-y-4 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-56 rounded-lg sm:h-9" />
      </div>
      <div className="grid overflow-hidden rounded-xl border border-border/60 bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid gap-3 border-b border-border/60 p-5 lg:border-b-0 lg:border-r">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-12 w-20" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="grid gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-60 w-full" />
      </div>
    </main>
  );
}
