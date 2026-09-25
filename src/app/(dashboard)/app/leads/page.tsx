import { PageHeader } from "@/components/layout/page-header";
import { CreateLeadDialog } from "@/features/leads/components/create-lead-dialog";
import { ExportLeadsButton } from "@/features/leads/components/export-leads-button";
import { LeadsPagination } from "@/features/leads/components/leads-pagination";
import { LeadsTable } from "@/features/leads/components/leads-table";
import {
  getLeadsPage,
  getLeadsSummary,
} from "@/features/leads/queries/get-leads";
import { getTags } from "@/features/leads/queries/get-tags";
import { getBoardColumns } from "@/features/board/queries/get-board-columns";
import { getLeadAttributions } from "@/features/meta/queries/get-lead-attributions";
import { getLeadSales } from "@/features/financeiro/queries/get-lead-sales";
import { getProcedures } from "@/features/financeiro/queries/get-procedures";
import {
  parseLeadSearchColumn,
  sanitizeLeadSearch,
} from "@/features/leads/lib/leads-search";

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | string[] | undefined, fallback: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePositiveInt(params.page, 1);
  const pageSize = parsePositiveInt(params.pageSize, 20);
  const searchQuery = sanitizeLeadSearch(
    (Array.isArray(params.q) ? params.q[0] : params.q) ?? "",
  );
  const searchColumn = parseLeadSearchColumn(
    Array.isArray(params.column) ? params.column[0] : params.column,
  );

  const [leadsPage, summary, columns, tags] = await Promise.all([
    getLeadsPage({ page, pageSize, searchQuery, searchColumn }),
    getLeadsSummary(),
    getBoardColumns(),
    getTags(),
  ]);

  // Só os leads da página atual: a origem publicitária é buscada sob demanda.
  const pageLeadIds = leadsPage.items.map((lead) => lead.id);
  const [attributionsMap, salesMap, procedures] = await Promise.all([
    getLeadAttributions(pageLeadIds),
    getLeadSales(pageLeadIds),
    getProcedures(),
  ]);
  const attributions = Object.fromEntries(attributionsMap);
  const sales = Object.fromEntries(salesMap);

  return (
    <>
      <PageHeader title="Leads" description="Entradas, qualificação e cadastro manual" />
      <main className="flex flex-col gap-4 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div><h1 className="font-display text-2xl font-semibold tracking-tight">Leads</h1><p className="text-sm text-muted-foreground">Entradas, qualificação e cadastro manual</p></div>
          <div className="flex items-center gap-2"><ExportLeadsButton /><CreateLeadDialog columns={columns} /></div>
        </div>
        <LeadsTable
          leads={leadsPage.items}
          showSummary
          allTags={tags}
          summary={summary}
          attributions={attributions}
          sales={sales}
          procedures={procedures}
          initialSearchColumn={searchColumn}
          initialSearchQuery={searchQuery}
        />
        <LeadsPagination
          page={leadsPage.page}
          pageCount={leadsPage.pageCount}
          total={leadsPage.total}
          pageSize={leadsPage.pageSize}
          searchColumn={searchColumn}
          searchQuery={searchQuery}
        />
      </main>
    </>
  );
}
