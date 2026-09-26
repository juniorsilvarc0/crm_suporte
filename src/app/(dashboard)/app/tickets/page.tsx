import { redirect } from "next/navigation";

import { ListPagination } from "@/components/data-display/list-pagination";
import { TicketsTable } from "@/features/tickets/components/tickets-table";
import { ticketListSearch, TICKETS_PATH } from "@/features/tickets/lib/ticket-list-url";
import { getAssignableUsers } from "@/features/tickets/queries/get-assignable-users";
import { getTicketCatalog } from "@/features/tickets/queries/get-ticket-catalog";
import {
  getTicketsPage,
  parseTicketListParams,
} from "@/features/tickets/queries/get-tickets-page";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tickets",
};

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Usuário confirmado no BANCO antes de qualquer leitura: o layout não roda
  // de novo na navegação pelo cliente, e o proxy só confere a assinatura do
  // cookie — um usuário desativado segue com cookie válido por até 7 dias.
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  const params = parseTicketListParams(await searchParams);
  const [tickets, catalog, users] = await Promise.all([
    getTicketsPage(params, viewer.id),
    getTicketCatalog(),
    // A equipe do ticket (sem e-mail nem papel). `null` = a leitura falhou.
    getAssignableUsers(),
  ]);

  return (
    <main className="mx-auto w-full max-w-screen-xl space-y-4 p-4 sm:p-6 lg:p-8">
      <TicketsTable
        page={tickets}
        params={params}
        // Só o que a lista usa, campo a campo: o resto do catálogo e da
        // equipe (avatar) não vai para o navegador.
        catalog={{
          statuses: catalog.statuses,
          transitions: catalog.transitions,
          queues: catalog.products?.map(({ id, name }) => ({ id, name })) ?? null,
        }}
        users={users?.map(({ id, name, is_active }) => ({ id, name, is_active })) ?? null}
        viewerId={viewer.id}
      />
      <ListPagination
        basePath={TICKETS_PATH}
        // Os filtros já lidos, não a URL crua: valor fora da allowlist não
        // viaja de página em página.
        searchParams={ticketListSearch(params)}
        page={tickets.page}
        pageCount={tickets.pageCount}
        total={tickets.total}
        pageSize={tickets.pageSize}
        noun={["ticket", "tickets"]}
      />
    </main>
  );
}
