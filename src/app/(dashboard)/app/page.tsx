import { PageHeader } from "@/components/layout/page-header";
import { FloatingChatButton } from "@/features/home/components/floating-chat-button";
import { NotesPanel } from "@/features/home/components/notes-panel";
import { getNotes } from "@/features/home/queries/get-notes";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

/**
 * Início — a tela de abertura do dia.
 *
 * Por ora, só o mural de notas do usuário. A fila de tickets ("Minha fila" e
 * "Não atribuídos") entra aqui na Fase 4 de `docs/PLANO-IMPLANTACAO.md`.
 */
export default async function HomePage() {
  // O layout de `/app` já barra sessão inválida; aqui o viewer serve só para
  // saber DE QUEM são as notas.
  const viewer = await getDashboardViewer();
  const notes = viewer
    ? await getNotes(viewer.id)
    : { quick: { content: "", updatedAt: null }, stickies: [] };

  return (
    <>
      <PageHeader title="Início" />
      <main className="mx-auto w-full max-w-screen-2xl p-3 sm:p-4 lg:p-6">
        <NotesPanel initial={notes} />
      </main>
      <FloatingChatButton />
    </>
  );
}
