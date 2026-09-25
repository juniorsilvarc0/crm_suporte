import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { LEADS_PAGE_SIZE } from "@/features/leads/queries/get-leads";
import { cn } from "@/lib/utils";
import type { LeadSearchColumn } from "@/features/leads/lib/leads-search";

export function LeadsPagination({
  page,
  pageCount,
  total,
  pageSize,
  searchColumn,
  searchQuery,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  searchColumn?: LeadSearchColumn;
  searchQuery?: string;
}) {
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    if (target > 1) params.set("page", String(target));
    if (pageSize !== LEADS_PAGE_SIZE) params.set("pageSize", String(pageSize));
    if (searchQuery) {
      params.set("q", searchQuery);
      if (searchColumn && searchColumn !== "lead") params.set("column", searchColumn);
    }
    const qs = params.toString();
    return qs ? `/app/leads?${qs}` : "/app/leads";
  };

  const controlClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1");
  const disabledClass = cn(controlClass, "pointer-events-none opacity-50");

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground tabular-nums">
        {start}–{end} de {total} {total === 1 ? "lead" : "leads"}
      </p>

      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} className={controlClass} rel="prev">
              <ChevronLeftIcon className="size-4" aria-hidden />
              Anterior
            </Link>
          ) : (
            <span className={disabledClass} aria-disabled>
              <ChevronLeftIcon className="size-4" aria-hidden />
              Anterior
            </span>
          )}

          <span className="text-sm tabular-nums text-muted-foreground">
            Página {page} de {pageCount}
          </span>

          {page < pageCount ? (
            <Link href={hrefFor(page + 1)} className={controlClass} rel="next">
              Próxima
              <ChevronRightIcon className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className={disabledClass} aria-disabled>
              Próxima
              <ChevronRightIcon className="size-4" aria-hidden />
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
