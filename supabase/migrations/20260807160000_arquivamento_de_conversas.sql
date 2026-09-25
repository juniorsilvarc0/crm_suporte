-- Arquivar é uma organização da lista e não pode reutilizar `status=resolved`:
-- resolver muda o takeover da IA, enquanto arquivar só esconde a conversa da
-- caixa principal. A coluna nullable preserva todas as conversas atuais ativas.
alter table public.chat_conversations
  add column if not exists archived_at timestamptz;

-- A caixa de arquivadas é normalmente pequena e sempre ordena pela última
-- mensagem. O índice parcial evita carregar a caixa principal inteira.
create index if not exists chat_conversations_archived_last_message_idx
  on public.chat_conversations (last_message_at desc nulls last)
  where archived_at is not null;
