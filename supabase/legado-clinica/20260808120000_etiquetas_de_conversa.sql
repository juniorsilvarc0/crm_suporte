-- Etiquetas de conversa (N:N), no mesmo modelo de `lead_tags`.
--
-- Reutiliza a tabela `tags` de propósito: uma etiqueta "Novo cliente" é a mesma
-- coisa no funil e no chat, e duas tabelas de etiqueta significariam dois
-- vocabulários para o mesmo operador. O que muda é só a ponta do vínculo.
create table if not exists public.conversation_tags (
  conversation_id uuid not null,
  tag_id          uuid not null,
  created_at      timestamptz not null default now(),
  constraint conversation_tags_pkey primary key (conversation_id, tag_id),
  constraint conversation_tags_conversation_id_fkey
    foreign key (conversation_id) references public.chat_conversations (id) on delete cascade,
  constraint conversation_tags_tag_id_fkey
    foreign key (tag_id) references public.tags (id) on delete cascade
);

-- Filtrar a lista por etiqueta parte do `tag_id`; a chave primária já cobre o
-- caminho inverso (etiquetas de uma conversa).
create index if not exists conversation_tags_tag_id_idx
  on public.conversation_tags (tag_id);

-- RLS ligada e NENHUMA policy — exatamente como `tags` e `lead_tags`, que é o
-- estado verificado em produção. Sem policy, só a service role enxerga (ela
-- ignora RLS), e é por ela que o app lê: route handler no servidor.
--
-- ⚠️ Não crie policy de SELECT para `anon` aqui. As duas exceções do banco
-- (`chat_conversations`, `chat_messages`) existem para o Realtime do chat
-- funcionar no browser; a etiqueta não passa por Realtime e não precisa. Abrir
-- para `anon` é decisão de segurança (AGENTS.md §3.1), não detalhe de
-- implementação.
alter table public.conversation_tags enable row level security;
