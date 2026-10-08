import { redirect } from "next/navigation";

import { TicketsBoard } from "@/features/tickets/components/tickets-board";
import { getAssignableUsers } from "@/features/tickets/queries/get-assignable-users";
import { getTicketCatalog } from "@/features/tickets/queries/get-ticket-catalog";
import { getTicketsBoard } from "@/features/tickets/queries/get-tickets-board";
import { parseTicketListParams } from "@/features/tickets/queries/get-tickets-page";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Quadro de tickets",
};

export default async function TicketsBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Usuário confirmado no BANCO antes de qualquer leitura (o layout não roda de
  // novo na navegação pelo cliente). Mesma guarda da lista.
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  const params = parseTicketListParams(await searchParams);
  const [board, catalog, users] = await Promise.all([
    getTicketsBoard(params, viewer.id),
    getTicketCatalog(),
    getAssignableUsers(),
  ]);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-screen-2xl flex-1 flex-col p-4 sm:p-6 lg:p-8">
      <TicketsBoard
        board={board}
        params={params}
        // Só o que o quadro usa, campo a campo (o resto do catálogo e da equipe
        // não vai para o navegador).
        catalog={{
          statuses: catalog.statuses,
          transitions: catalog.transitions,
          queues: catalog.products?.map(({ id, name }) => ({ id, name })) ?? null,
        }}
        users={users?.map(({ id, name, is_active }) => ({ id, name, is_active })) ?? null}
        viewerId={viewer.id}
      />
    </main>
  );
}
