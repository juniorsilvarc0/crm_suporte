/**
 * Coluna horizontal compartilhada por mensagens, busca e compositor.
 *
 * Não há `max-w`: em telas largas a conversa acompanha o painel. O clamp
 * mantém a borda próxima sem deixar o conteúdo colado em monitores ultrawide.
 */
export const CHAT_COLUMN_CLASS =
  "mx-auto w-full px-2 sm:px-5 lg:px-[clamp(2rem,3vw,4.5rem)]";
