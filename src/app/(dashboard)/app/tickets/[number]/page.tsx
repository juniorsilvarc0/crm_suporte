import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { EmptyState } from "@/components/data-display/empty-state";
import { TicketDetailView } from "@/features/tickets/components/ticket-detail";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { getAssignableUsers } from "@/features/tickets/queries/get-assignable-users";
import { getTicketCatalog } from "@/features/tickets/queries/get-ticket-catalog";
import { getTicketDetail } from "@/features/tickets/queries/get-ticket-detail";
import { getTicketTimeline } from "@/features/tickets/queries/get-ticket-timeline";
import type { TicketTimelinePage } from "@/features/tickets/types";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

// O protocolo da URL (tickets.number): só dígitos, senão nem chega ao banco.
const NUMBER_RE = /^\d+$/;

const PAGE_CLASS = "mx-auto w-full max-w-screen-xl p-4 sm:p-6 lg:p-8";

// O título da aba sai da própria URL, sem consulta: "SUP-1024".
export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>;
}): Promise<Metadata> {
  const { number } = await params;
  const value = NUMBER_RE.test(number) ? Number(number) : NaN;
  return { title: Number.isSafeInteger(value) && value > 0 ? formatProtocol(value) : "Ticket" };
}

/**
 * Detalhe do ticket pelo protocolo. Usuário confirmado no BANCO antes da 1ª
 * leitura (o layout não roda de novo na navegação pelo cliente). A leitura do
 * ticket decide 404 ou "indisponível"; timeline, catálogo e equipe correm
 * juntas depois e falham cada uma na sua seção.
 *
 * Nada de ai_triage nem da chave de idempotência: as queries não os leem, e o
 * payload do RSC só leva o que a tela mostra.
 */
export default async function TicketPage({ params }: { params: Promise<{ number: string }> }) {
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  const { number } = await params;
  if (!NUMBER_RE.test(number)) notFound();

  const detail = await getTicketDetail(Number(number));
  if (detail.status === "not_found") notFound();
  if (detail.status === "error") return <DetailUnavailable />;

  const { ticket, attachments, fetchedAt } = detail;
  const [timeline, catalog, team] = await Promise.all([
    // A timeline LANÇA em erro (a rota responde 500): aqui vira a seção com
    // "Tentar de novo", e o resto do detalhe abre.
    getTicketTimeline(ticket.id).catch((error: unknown): TicketTimelinePage | null => {
      console.error("TicketPage timeline failed", error);
      return null;
    }),
    getTicketCatalog(),
    getAssignableUsers(),
  ]);

  return (
    <main className={PAGE_CLASS}>
      <TicketDetailView
        ticket={ticket}
        attachments={attachments}
        timeline={timeline}
        catalog={catalog}
        team={team}
        viewerId={viewer.id}
        fetchedAt={fetchedAt}
      />
    </main>
  );
}

function DetailUnavailable() {
  return (
    <main className={`${PAGE_CLASS} space-y-3`}>
      <Link
        href="/app/tickets"
        className="-ms-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Tickets
      </Link>
      <EmptyState>Não foi possível carregar o ticket. Recarregue a página.</EmptyState>
    </main>
  );
}
