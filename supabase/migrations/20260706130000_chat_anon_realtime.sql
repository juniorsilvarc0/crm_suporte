-- ============================================================================
-- Realtime do chat: acesso ANON explícito (via migration, não só no seed de dev).
--
-- Os hooks de chat rodam no BROWSER com a chave anon: use-conversations lê
-- chat_conversations; use-chat-realtime assina postgres_changes em
-- chat_messages/chat_conversations. Para a lista de conversas e as mensagens ao
-- vivo carregarem, o anon precisa poder LER essas duas tabelas — e o realtime do
-- Supabase respeita RLS para o papel que assina (anon).
--
-- O chat_module criou essas tabelas com RLS ligada e policy só para service_role,
-- então sem isto o browser recebe 0 linhas / permission denied em PRODUÇÃO (o
-- seed dev-only abria o acesso, mascarando a quebra). Aqui garantimos o acesso
-- por MIGRATION, então dev e produção ficam iguais.
--
-- RESÍDUO de segurança conhecido: a chave anon (pública) consegue ler o conteúdo
-- do chat. Passo seguinte de hardening: realtime AUTENTICADO (JWT do Supabase por
-- usuário + policy por papel) para remover o acesso anon.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['chat_conversations', 'chat_messages'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('grant select on public.%I to anon, authenticated', t);
      execute format('drop policy if exists chat_anon_realtime_read on public.%I', t);
      execute format(
        'create policy chat_anon_realtime_read on public.%I for select to anon, authenticated using (true)',
        t
      );
    end if;
  end loop;
end $$;
