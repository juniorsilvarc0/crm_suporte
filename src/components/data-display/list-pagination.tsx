import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Link da página `target` de uma lista paginada pela URL. Mantém os filtros
 * que já estão na URL (`q`, `situacao`, `empresa`…) e troca só `page`; a
 * página 1 sai sem `page`, como o resto do app escreve a URL limpa.
 */
export function listPageHref(basePath: string, searchParams: SearchParams, target: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "page" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== "") params.append(key, item);
    }
  }
  if (target > 1) params.set("page", String(target));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Paginação compartilhada das telas de dados (UI.md §5.1): "1–25 de 312
 * empresas" e Anterior/Próxima como links, sem estado no cliente — a página é
 * server-side (`count` + `range`) e a URL é a fonte da verdade.
 *
 * Server-safe: sem `"use client"`, a página renderiza direto.
 * Lista vazia (ou que falhou, com `total` 0) não mostra paginação.
 */
export function ListPagination({
  basePath,
  searchParams,
  page,
  pageCount,
  total,
  pageSize,
  noun,
}: {
  basePath: string;
  searchParams: SearchParams;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** Singular e plural: ["empresa", "empresas"]. */
  noun: readonly [singular: string, plural: string];
}) {
  if (total <= 0) return null;

  const start = Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);

  // Alvo de 44px no toque; volta à densidade do desktop a partir de `sm`.
  const controlClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 gap-1 px-3 sm:h-8");
  const disabledClass = cn(controlClass, "pointer-events-none opacity-50");

  return (
    <nav
      aria-label="Paginação"
      className="flex flex-col items-center justify-between gap-3 sm:flex-row"
    >
      <p className="text-sm text-muted-foreground tabular-nums">
        {start}–{end} de {total} {total === 1 ? noun[0] : noun[1]}
      </p>

      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={listPageHref(basePath, searchParams, page - 1)} className={controlClass} rel="prev">
              <ChevronLeftIcon className="size-4" aria-hidden />
              Anterior
            </Link>
          ) : (
            <span className={disabledClass} aria-disabled="true">
              <ChevronLeftIcon className="size-4" aria-hidden />
              Anterior
            </span>
          )}

          <span className="text-sm tabular-nums text-muted-foreground">
            Página {page} de {pageCount}
          </span>

          {page < pageCount ? (
            <Link href={listPageHref(basePath, searchParams, page + 1)} className={controlClass} rel="next">
              Próxima
              <ChevronRightIcon className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className={disabledClass} aria-disabled="true">
              Próxima
              <ChevronRightIcon className="size-4" aria-hidden />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}
