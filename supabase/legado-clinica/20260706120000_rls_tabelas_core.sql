-- ============================================================================
-- A4 — Protege as tabelas de dados com RLS (Row Level Security).
--
-- Antes: RLS desligada nas tabelas core → a chave ANON (pública, embarcada no
-- browser via NEXT_PUBLIC_*) conseguia ler TODOS os dados (leads, financeiro,
-- tokens de integração) direto na API REST do Supabase.
--
-- Agora: o app lê/escreve server-side com a SERVICE KEY (que ignora RLS). A
-- chave anon só é usada pelo realtime do chat no browser. Com RLS LIGADA e sem
-- policies, anon/authenticated ficam bloqueados nas tabelas abaixo — a chave
-- pública não lê mais esses dados.
--
-- Ficam DE FORA (o realtime do chat no browser usa anon): chat_conversations e
-- chat_messages. app_users já está protegida (migration de autenticação).
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'leads', 'appointments', 'followups', 'integration_logs',
    'contracts', 'payments', 'expenses',
    'tags', 'lead_tags', 'board_columns', 'feedback_requests',
    'chat_integrations', 'chat_quick_replies'
  ]
  loop
    -- to_regclass evita erro se alguma tabela não existir no ambiente.
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
