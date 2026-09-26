import { Skeleton } from "@/components/ui/skeleton";

// Geometria da ficha (customer-detail.tsx): voltar, cabeçalho com ações e as
// duas colunas — contrato à esquerda, contatos e observações à direita.
export default function CustomerLoading() {
  return (
    <main
      className="mx-auto w-full max-w-screen-xl space-y-6 p-4 sm:p-6 lg:space-y-8 lg:p-8"
      aria-label="Carregando empresa"
    >
      <div className="space-y-3">
        <Skeleton className="h-5 w-20" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="mt-3 h-5 w-32 rounded-full" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-11 w-full rounded-full sm:h-9 sm:w-24" />
            <Skeleton className="h-11 w-full rounded-full sm:h-9 sm:w-28" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="min-w-0 space-y-3 lg:col-span-2">
          <Skeleton className="h-3 w-16" />
          <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
            <Skeleton className="h-5 w-32 rounded-full" />
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-40 max-w-full" />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <Skeleton className="h-3 w-24" />
          <div className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card shadow-soft">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <Skeleton className="size-9 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 max-w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="size-11 rounded-full sm:size-9" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
