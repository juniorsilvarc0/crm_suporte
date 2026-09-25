export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-border/80 bg-card px-6 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
