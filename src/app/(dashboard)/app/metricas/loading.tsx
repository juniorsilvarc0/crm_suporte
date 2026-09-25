import { Skeleton } from "@/components/ui/skeleton";

function Panel({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-64 rounded-lg ${className}`} />;
}

export default function Loading() {
  return (
    <>
      <div className="flex h-16 items-center justify-between border-b border-border/70 px-4 sm:px-6 lg:px-8"><Skeleton className="h-7 w-36" /><Skeleton className="h-9 w-48" /></div>
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 p-4 sm:p-6 lg:p-8">
        <div className="grid overflow-hidden rounded-lg border border-border/70 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="border-b border-border/70 p-4 last:border-b-0 sm:border-r xl:border-b-0"><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-8 w-20" /><Skeleton className="mt-2 h-3 w-32" /></div>)}
        </div>
        <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]"><Panel /><Panel /></section>
        <section className="grid gap-4 lg:grid-cols-3"><Panel className="h-80" /><Panel className="h-80" /><Panel className="h-80" /></section>
        <Skeleton className="h-72 rounded-lg" />
      </main>
    </>
  );
}
