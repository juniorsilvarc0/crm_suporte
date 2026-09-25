import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { sanitizeLeadSearch } from "@/features/leads/lib/leads-search";
import { PatientsTable } from "@/features/patients/components/patients-table";
import {
  PATIENTS_PAGE_SIZE,
  getPatientsPage,
} from "@/features/patients/queries/get-patients";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | string[] | undefined, fallback: number) {
  const parsed = Number.parseInt(firstParam(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePositiveInt(params.page, 1);
  const pageSize = parsePositiveInt(params.pageSize, PATIENTS_PAGE_SIZE);
  const searchQuery = sanitizeLeadSearch(firstParam(params.q) ?? "");

  const patientsPage = await getPatientsPage({ page, pageSize, query: searchQuery });

  return (
    <>
      <PageHeader title="Pacientes" description="Cadastro clínico de quem já é atendido" />
      <main className="flex flex-col gap-4 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight">Pacientes</h1>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {patientsPage.total}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">Cadastro clínico de quem já é atendido</p>
          </div>
        </div>
        <PatientsTable patients={patientsPage.items} initialSearchQuery={searchQuery} />
        <PatientsPagination
          page={patientsPage.page}
          pageCount={patientsPage.pageCount}
          total={patientsPage.total}
          pageSize={patientsPage.pageSize}
          explicitPageSize={firstParam(params.pageSize)}
          searchQuery={searchQuery}
        />
      </main>
    </>
  );
}

/**
 * Rodapé de paginação da lista. Fica aqui, e não em `features/`, porque só
 * monta link a partir dos parâmetros desta rota — não há regra de domínio.
 */
function PatientsPagination({
  page,
  pageCount,
  total,
  pageSize,
  explicitPageSize,
  searchQuery,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  explicitPageSize?: string;
  searchQuery?: string;
}) {
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    if (target > 1) params.set("page", String(target));
    // Só devolve `pageSize` à URL se quem navegou já o tinha escolhido.
    if (explicitPageSize) params.set("pageSize", explicitPageSize);
    if (searchQuery) params.set("q", searchQuery);
    const qs = params.toString();
    return qs ? `/app/pacientes?${qs}` : "/app/pacientes";
  };

  const controlClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1");
  const disabledClass = cn(controlClass, "pointer-events-none opacity-50");

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm tabular-nums text-muted-foreground">
        {start}–{end} de {total} {total === 1 ? "paciente" : "pacientes"}
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
