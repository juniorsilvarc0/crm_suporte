import { Skeleton } from "@/components/ui/skeleton";

export default function PerfilLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10" aria-label="Carregando perfil">
      <div className="flex items-center gap-5"><Skeleton className="size-28 rounded-full" /><div className="space-y-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-56" /><Skeleton className="h-5 w-24" /></div></div>
      <div className="mt-8 space-y-4 border-t border-border/70 pt-6"><Skeleton className="h-3 w-20" /><div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div><Skeleton className="h-7 w-72" /></div>
      <div className="mt-8 space-y-4 border-t border-border/70 pt-6"><Skeleton className="h-3 w-20" /><div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div></div>
    </main>
  );
}
