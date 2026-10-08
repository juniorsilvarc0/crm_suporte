-- ============================================================================
-- Testes de sla_sweep (20261008120000 · Fase 6a). Rodados por
-- scripts/db-local-test.sh, como service_role (o papel do worker), em ROLLBACK.
--
-- A prova é de COMPLETUDE contra a PRÓPRIA view ticket_queue: depois da
-- varredura, nenhum ticket que a view considera vencido pode ficar sem o
-- carimbo *_breached_at, e nenhum resolvido há mais de 72h pode continuar
-- aberto. Se um dia o critério do sweep divergir do da view, isto falha. Mais a
-- idempotência (a 2ª passada não faz nada).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;

set role service_role;

do $$
declare
  v2         jsonb;
  v_fr_left  integer;
  v_res_left integer;
  v_open_72h integer;
begin
  perform public.sla_sweep();

  -- Todo first_response/ resolução que a view marca como vencido ficou carimbado.
  select pg_catalog.count(*) into v_fr_left
    from public.ticket_queue q
    join public.tickets t on t.id = q.id
   where q.first_response_overdue and t.first_response_breached_at is null;

  select pg_catalog.count(*) into v_res_left
    from public.ticket_queue q
    join public.tickets t on t.id = q.id
   where q.resolution_overdue and t.resolution_breached_at is null;

  select pg_catalog.count(*) into v_open_72h
    from public.tickets t
   where t.status = 'resolvido'
     and t.resolved_at <= pg_catalog.now() - interval '72 hours';

  insert into r values (v_fr_left = 0,
    'sla_sweep carimba todo first_response vencido da view',
    pg_catalog.format('%s sem carimbo', v_fr_left));
  insert into r values (v_res_left = 0,
    'sla_sweep carimba toda resolução vencida da view',
    pg_catalog.format('%s sem carimbo', v_res_left));
  insert into r values (v_open_72h = 0,
    'sla_sweep fecha o resolvido há mais de 72h',
    pg_catalog.format('%s ainda aberto(s)', v_open_72h));

  -- Idempotência: a 2ª passada não carimba nem fecha nada.
  v2 := public.sla_sweep();
  insert into r values (
    (v2->>'first_response')::integer = 0
      and (v2->>'resolution')::integer = 0
      and (v2->>'closed')::integer = 0,
    'sla_sweep é idempotente (2ª passada = 0)', v2::text);
end
$$;

reset role;

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes de sla_sweep falharam: %', v_falhas;
  end if;
  raise notice 'testes de sla_sweep: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
