import { Suspense } from "react";
import { ChatShell } from "@/features/chat/components/chat-shell";
import { getBoardColumns } from "@/features/board/queries/get-board-columns";

export const metadata = {
  title: "Chat",
  description: "Atendimento ao vivo via WhatsApp",
};

export default async function ChatPage() {
  // As etapas do funil vêm do SERVIDOR, junto da página: são a mesma fonte que
  // desenha o Kanban (`board_columns`), e buscá-las de novo no cliente seria um
  // request a mais para um dado que muda uma vez por trimestre.
  //
  // Só `key` e `label` atravessam a fronteira: o resto da coluna (probabilidade,
  // tipo de etapa, conversão) não tem uso na barra de filtros.
  const columns = await getBoardColumns();
  const stages = columns.map((column) => ({ key: column.key, label: column.label }));

  return (
    // Esta altura pertence sempre à lista. No celular, a conversa aberta vira
    // um overlay fixo dentro do ChatShell e não altera a geometria da casca.
    <div className="chat-page wa-surface flex h-[calc(100dvh-var(--app-chrome-top)-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col overflow-hidden lg:h-[calc(100dvh-var(--app-chrome-top))]">
      {/* ChatShell usa useSearchParams (deep-link ?lead & ?phone), que exige
          um limite de Suspense no Next 16 em páginas renderizadas estaticamente. */}
      <Suspense fallback={null}>
        <ChatShell stages={stages} />
      </Suspense>
    </div>
  );
}
