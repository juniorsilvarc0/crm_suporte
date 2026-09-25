-- Fixar conversa no topo da lista, como no WhatsApp/iOS.
--
-- Coluna de data e não booleano: além de dizer SE está fixada, ela ordena as
-- fixadas entre si. No WhatsApp a fixada mais recente fica acima das outras, e
-- com `boolean` isso exigiria uma segunda coluna só para o desempate.
alter table public.chat_conversations
  add column if not exists pinned_at timestamptz;

-- As fixadas são poucas (o WhatsApp limita a 3) e são lidas em TODA abertura da
-- lista. O índice parcial cobre exatamente essa consulta sem pesar nas 425
-- linhas que não estão fixadas.
create index if not exists chat_conversations_pinned_idx
  on public.chat_conversations (pinned_at desc)
  where pinned_at is not null;
