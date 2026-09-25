import { Skeleton } from "@/components/ui/skeleton";

export default function EquipeLoading() {
  return (
    <main className="mx-auto w-full max-w-screen-xl space-y-3 p-4 sm:p-6 lg:p-8" aria-label="Carregando equipe">
      <div className="space-y-2"><Skeleton className="h-6 w-28" /><Skeleton className="h-4 w-44" /></div>
      <div className="flex gap-2 border-b border-border/70 py-3"><Skeleton className="h-9 flex-1 sm:max-w-sm" /><Skeleton className="ml-auto h-9 w-24" /><Skeleton className="h-9 w-32" /></div>
      <div className="overflow-hidden rounded-lg border border-border/70"><Skeleton className="h-11 w-full rounded-none" />{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-3 border-t border-border/70 p-3"><Skeleton className="size-10 rounded-full" /><div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div></div>)}</div>
    </main>
  );
}
