-- ============================================================================
-- Fase 4 · ticket_queue ganha replied_after_resolve: o cliente respondeu depois
-- de o ticket ser resolvido.
--
-- Achado da revisão do PR 5 (Início): o sinal "Respondeu após resolver" pede
-- ação, mas a Minha fila ordena por prazo, o resolvido (sem prazo) ia para o fim
-- e o corte em 8 o escondia; o "Ver todos (N)" levava a outro total; e resolvido
-- SEM responsável que o cliente respondeu não aparecia em seção nenhuma. O
-- PostgREST não compara coluna com coluna (last_inbound_at > resolved_at), então
-- a comparação mora aqui, como o resto do SLA da view.
--
-- Decisão do dono (2026-09-26): a fila do Início = relógio correndo ou pausado
-- MAIS resolvido com resposta do cliente, estes primeiro.
--
-- CREATE OR REPLACE VIEW: as colunas existentes mantêm nome, tipo e ordem (a
-- nova vai no FIM); o corpo muda só para ler last_inbound_at uma vez (lateral).
-- Grants e security_invoker se mantêm; o revoke/grant abaixo repete os do
-- 20260925120900 para a migration valer sozinha. Depende de 20260925120900.
-- ============================================================================

do $$
begin
  if to_regclass('public.ticket_queue') is null then
    raise exception 'FILA: aplique 20260925120900_tickets antes';
  end if;
end
$$;

create or replace view public.ticket_queue
with (security_invoker = true)
as
select
  t.id, t.number, t.title, t.description, t.status, t.priority, t.version,
  t.conversation_id, t.contact_id, t.customer_id, t.contract_id,
  t.product_id, t.category_id, t.assigned_to_user_id, t.created_by_user_id,
  t.source, t.reopened_count,
  t.sla_first_response_minutes, t.sla_resolution_minutes, t.sla_warn_pct,
  t.first_response_due_at, t.resolution_due_at,
  t.first_responded_at, t.first_ai_response_at,
  t.sla_paused_at, t.sla_paused_seconds, t.resolved_at, t.closed_at,
  t.created_at, t.updated_at,
  s.sla_mode, s.is_terminal, p.rank as priority_rank,
  b.first_response_overdue,
  b.resolution_overdue,
  (b.first_response_overdue or b.resolution_overdue) as sla_breached,
  ( not (b.first_response_overdue or b.resolution_overdue)
    and s.sla_mode <> 'stopped'
    and ( (t.first_responded_at is null
           and pg_catalog.now() >= t.first_response_due_at
               - pg_catalog.make_interval(secs => t.sla_first_response_minutes * (100 - t.sla_warn_pct) * 0.6))
       or (s.sla_mode = 'running'
           and pg_catalog.now() >= t.resolution_due_at
               - pg_catalog.make_interval(secs => t.sla_resolution_minutes * (100 - t.sla_warn_pct) * 0.6)) )
  ) as sla_at_risk,
  case
    when s.sla_mode = 'stopped' then null
    when t.first_responded_at is null then t.first_response_due_at
    when s.sla_mode = 'running' then t.resolution_due_at
  end as next_due_at,
  -- "Cliente respondeu depois de resolver" (4d) e, na Fase 6, o sweep não fecha.
  li.last_inbound_at,
  pg_catalog.concat_ws(' ', t.search_title, ct.search_name, cu.search_name) as search_text,
  -- Nunca nulo: a fila ordena por esta coluna (desc), e nulo viria primeiro.
  coalesce(t.status = 'resolvido' and li.last_inbound_at > t.resolved_at, false) as replied_after_resolve
from public.tickets t
join public.ticket_statuses s on s.key = t.status
join public.sla_policies p on p.priority = t.priority
join public.contacts ct on ct.id = t.contact_id
left join public.customers cu on cu.id = t.customer_id
cross join lateral (
  select
    -- 1ª resposta: relógio de parede (não pausa); some quando responde ou para.
    (t.first_responded_at is null and s.sla_mode <> 'stopped'
     and t.first_response_due_at <= pg_catalog.now()) as first_response_overdue,
    -- Solução: parada, vale o instante em que parou.
    (s.sla_mode <> 'stopped'
     and t.resolution_due_at <= coalesce(t.sla_paused_at, pg_catalog.now())) as resolution_overdue
) b
cross join lateral (
  select pg_catalog.max(m.created_at) as last_inbound_at
    from public.chat_messages m
   where m.ticket_id = t.id and m.direction = 'inbound'
) li;

revoke all on public.ticket_queue from public, anon, authenticated, service_role;
grant select on public.ticket_queue to service_role;

comment on column public.ticket_queue.replied_after_resolve is
  'Resolvido e o cliente mandou mensagem depois de resolved_at (sinal "Respondeu após resolver"). Nunca nulo.';

select public.assert_security_baseline();
