import { PageHeader } from "@/components/layout/page-header";
import { FloatingChatButton } from "@/features/home/components/floating-chat-button";
import { NotesPanel } from "@/features/home/components/notes-panel";
import { getNotes } from "@/features/home/queries/get-notes";
import type { HomeNotes } from "@/features/home/types";
import { TicketQueuePanel } from "@/features/tickets/components/ticket-queue-panel";
import { getTicketQueue } from "@/features/tickets/queries/get-ticket-queue";
import type { TicketQueue } from "@/features/tickets/types";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

const EMPTY_NOTES: HomeNotes = { quick: { content: "", updatedAt: null }, stickies: [] };

/**
 * Início — a tela de abertura do dia.
 *
 * A fila de tickets ("Minha fila" e "Não atribuídos") vem ACIMA do mural de
 * notas: é o trabalho do dia, com prazo correndo, e o mural é lembrete pessoal.
 * Lado a lado, as duas seções da fila e as três colunas do mural disputariam
 * a largura, e a fila perderia a linha inteira que o título e as ações pedem.
 */
export default async function HomePage() {
  // O layout de `/app` já barra sessão inválida; aqui o viewer serve para
  // saber DE QUEM são as notas e a fila (e não roda de novo na navegação pelo
  // cliente: sem viewer, nenhuma consulta).
  const viewer = await getDashboardViewer();
  const [notes, queue]: [HomeNotes, TicketQueue | null] = viewer
    ? await Promise.all([getNotes(viewer.id), getTicketQueue(viewer.id)])
    : [EMPTY_NOTES, null];

  return (
    <>
      <PageHeader title="Início" />
      <main className="mx-auto w-full max-w-screen-2xl space-y-4 p-3 sm:p-4 lg:space-y-6 lg:p-6">
        <TicketQueuePanel queue={queue} />
        <NotesPanel initial={notes} />
      </main>
      <FloatingChatButton />
    </>
  );
}
