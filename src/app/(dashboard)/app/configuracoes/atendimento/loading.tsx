import { Skeleton } from "@/components/ui/skeleton";

// Geometria da página: o trilho das abas em pílula e a aba padrão (Filas) —
// título com a descrição e "Nova fila" ao lado, e a lista com as ações de cada
// linha (empilhadas no celular).
export default function AtendimentoLoading() {
  return (
    <main className="min-w-0 space-y-5 p-4 sm:p-6 lg:p-8" aria-label="Carregando atendimento">
      <Skeleton className="h-13 w-72 max-w-full rounded-full sm:h-11" />

      <div className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-11 w-full rounded-md sm:h-9 sm:w-28" />
        </div>

        <div className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card shadow-soft">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <Skeleton className="mt-1.5 size-2.5 shrink-0 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Skeleton className="h-11 rounded-md sm:h-8 sm:w-24" />
                <Skeleton className="h-11 rounded-md sm:h-8 sm:w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
