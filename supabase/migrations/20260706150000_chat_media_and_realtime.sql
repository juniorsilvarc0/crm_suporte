-- ============================================================================
-- Fundação do chat em tempo real (uazapi):
--   1) Bucket de storage `chat-media` — playback de áudio/imagem na nossa UI e
--      re-hospedagem de mídia inbound (as URLs da uazapi/WhatsApp expiram).
--   2) Índice em chat_messages(external_id) — o webhook casa status/echo por
--      external_id (messageid) e o upsert dedup por (conversation_id, external_id).
--   3) Garante chat_conversations/chat_messages na publication supabase_realtime.
--      A migration de realtime (20260612180000) roda ANTES do chat_module
--      (20260622), então num `db reset` limpo essas tabelas ficariam de fora e o
--      chat ao vivo quebraria. Aqui garantimos por migration (idempotente).
-- ============================================================================

-- 1) Bucket público p/ mídia do chat.
-- Público: o /send/media da uazapi baixa a URL, e o <audio>/<img> da UI lê direto.
-- O upload é feito pelo service_role (admin client), que ignora RLS.
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do update set public = true;

-- 2) Índice para o casamento de status/echo por external_id.
create index if not exists idx_chat_messages_external_id
  on public.chat_messages (external_id);

-- 3) Realtime: assegura as tabelas de chat na publication (idempotente).
do $$
declare
  t text;
begin
  foreach t in array array['chat_conversations', 'chat_messages'] loop
    if to_regclass('public.' || t) is not null then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception
        when duplicate_object then null; -- já está na publication
        when undefined_object then null; -- publication ainda não existe
      end;
    end if;
  end loop;
end $$;
