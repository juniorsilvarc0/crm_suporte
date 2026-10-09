-- ============================================================================
-- Testes de event_outbox (20261008140000 · Fase 6b). Rodados por
-- scripts/db-local-test.sh, em ROLLBACK. As RPCs rodam como service_role (o
-- worker); o que o app não faz (ler a tabela, plantar linha antiga) roda como
-- postgres. O service_role NÃO toca a tabela direto — só pelas RPCs.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;

-- 1. enqueue idempotente: mesmo kind+event_key devolve o mesmo id.
set role service_role;
do $$
declare id1 uuid; id2 uuid;
begin
  id1 := public.outbox_enqueue('relay', 'k1', '{"a":1}'::jsonb);
  id2 := public.outbox_enqueue('relay', 'k1', '{"b":2}'::jsonb);
  insert into r values (id1 is not null and id1 = id2,
    'enqueue idempotente devolve o mesmo id', id1::text || ' / ' || id2::text);
end
$$;
reset role;

-- grava uma linha só, e o 2º enqueue não sobrescreve o payload do 1º.
insert into r values (
  (select pg_catalog.count(*) from public.event_outbox where event_key = 'k1') = 1,
  'enqueue idempotente grava uma linha só', null);
insert into r values (
  (select payload->>'a' from public.event_outbox where event_key = 'k1') = '1',
  'enqueue repetido não sobrescreve o payload', null);

-- 2. service_role lê as colunas da entrega (20261009140000, a lista de entregas
--    dos webhooks), mas NUNCA a lease: ler não serve para finalizar a alheia. A
--    escrita segue só pelas RPCs.
set role service_role;
do $$
begin
  perform pg_catalog.count(*) from public.event_outbox where status is not null;
  insert into r values (true, 'service_role lê o status das entregas', null);
exception when insufficient_privilege then
  insert into r values (false, 'service_role lê o status das entregas', 'barrado');
end
$$;
do $$
begin
  perform o.lease_token from public.event_outbox o limit 1;
  insert into r values (false, 'service_role NÃO lê a lease do event_outbox', 'leu sem erro');
exception when insufficient_privilege then
  insert into r values (true, 'service_role NÃO lê a lease do event_outbox', 'barrado (ok)');
end
$$;
do $$
begin
  update public.event_outbox set status = 'sent' where false;
  insert into r values (false, 'service_role NÃO escreve event_outbox direto', 'escreveu sem erro');
exception when insufficient_privilege then
  insert into r values (true, 'service_role NÃO escreve event_outbox direto', 'barrado (ok)');
end
$$;
reset role;

-- 3. claim pega a pronta (processing + lease); 2ª vez não re-pega; settle com fencing.
set role service_role;
do $$
declare
  v_id uuid; v_token uuid; v_rows int; v_second int; v_wrong boolean; v_right boolean;
begin
  select id, lease_token into v_id, v_token from public.outbox_claim('w1', 'relay', 10, 8, 120);
  get diagnostics v_rows = row_count;
  insert into r values (v_rows = 1 and v_token is not null,
    'claim pega a pronta e carimba a lease', coalesce(v_token::text, 'sem token'));

  select pg_catalog.count(*) into v_second from public.outbox_claim('w2', 'relay', 10, 8, 120);
  insert into r values (v_second = 0,
    'claim não re-pega o que está em processing', v_second::text);

  v_wrong := public.outbox_settle(v_id, pg_catalog.gen_random_uuid(), 'sent', null, 200, null);
  insert into r values (v_wrong = false,
    'settle com token errado é recusado (fencing)', v_wrong::text);

  v_right := public.outbox_settle(v_id, v_token, 'sent', null, 200, null);
  insert into r values (v_right, 'settle com o token da lease finaliza', v_right::text);
end
$$;
reset role;

insert into r values (
  (select delivered_at is not null and lease_token is null and status = 'sent'
     from public.event_outbox where event_key = 'k1'),
  'sent carimba delivered_at e solta a lease', null);

-- 4. dead_letter por IDADE: linha velha + max_age curto não é entregue e morre.
insert into public.event_outbox (kind, event_key, created_at)
  values ('relay', 'velho', pg_catalog.now() - interval '10 minutes');
set role service_role;
do $$
declare v_n int;
begin
  select pg_catalog.count(*) into v_n from public.outbox_claim('w', 'relay', 10, 8, 120);
  insert into r values (v_n = 0, 'claim não entrega evento velho', v_n::text);
end
$$;
reset role;
insert into r values (
  (select status = 'dead_letter' from public.event_outbox where event_key = 'velho'),
  'evento velho vira dead_letter', null);

-- 5. dead_letter por TENTATIVAS, respeitando a lease viva. max_attempts=1: a 1ª
-- claim gasta a tentativa (processing, lease viva). Esgotado mas em voo NÃO é
-- morto nem re-pego. Só depois de a lease expirar (órfão) o claim o mata.
set role service_role;
do $$
declare v_first int; v_live int;
begin
  perform public.outbox_enqueue('webhook', 'esgota', '{}'::jsonb);
  select pg_catalog.count(*) into v_first from public.outbox_claim('w', 'webhook', 10, 1, 3600);
  insert into r values (v_first = 1, 'tentativas: a 1ª claim pega e gasta a tentativa', v_first::text);
  -- esgotado + lease viva: o worker ainda é o dono; não mata nem re-pega
  select pg_catalog.count(*) into v_live from public.outbox_claim('w', 'webhook', 10, 1, 3600);
  insert into r values (v_live = 0, 'esgotado em voo (lease viva) não é re-pego', v_live::text);
end
$$;
reset role;
insert into r values (
  (select status = 'processing' from public.event_outbox where event_key = 'esgota'),
  'esgotado em voo segue processing (não é morto em voo)', null);

-- Expira a lease à mão (o que só o tempo faria): agora, órfão e esgotado, morre.
update public.event_outbox set lease_expires_at = pg_catalog.to_timestamp(0) where event_key = 'esgota';
set role service_role;
do $$
declare v_n int;
begin
  select pg_catalog.count(*) into v_n from public.outbox_claim('w', 'webhook', 10, 1, 3600);
  insert into r values (v_n = 0, 'claim não entrega esgotado órfão', v_n::text);
end
$$;
reset role;
insert into r values (
  (select status = 'dead_letter' and attempts = 1
     from public.event_outbox where event_key = 'esgota'),
  'esgotado órfão (lease expirada) vira dead_letter', null);

-- 6. limit é elevado a [1,100]: limit 0 ainda pega ao menos 1 (nunca zero).
insert into public.event_outbox (kind, event_key) values ('webhook', 'lc1'), ('webhook', 'lc2');
set role service_role;
do $$
declare v_n int;
begin
  select pg_catalog.count(*) into v_n from public.outbox_claim('w', 'webhook', 0, 8, 3600);
  insert into r values (v_n = 1, 'limit 0 é elevado a 1 (nunca zero)', v_n::text);
end
$$;
reset role;

-- 7. Expurgo (20261009170000): só as ENCERRADAS sem mudança há mais de 30 dias.
--    O que ainda vai sair nunca é apagado, por mais velho que seja.
insert into public.event_outbox (kind, event_key, status, updated_at) values
  ('relay',   'purge-sent-velha',     'sent',        pg_catalog.now() - interval '31 days'),
  ('relay',   'purge-skipped-velha',  'skipped',     pg_catalog.now() - interval '31 days'),
  ('webhook', 'purge-dead-velha',     'dead_letter', pg_catalog.now() - interval '31 days'),
  ('relay',   'purge-sent-recente',   'sent',        pg_catalog.now() - interval '29 days'),
  ('webhook', 'purge-pending-velha',  'pending',     pg_catalog.now() - interval '60 days'),
  ('webhook', 'purge-retry-velha',    'retry',       pg_catalog.now() - interval '60 days');
set role service_role;
do $$
declare v_n integer;
begin
  v_n := public.outbox_purge();
  insert into r values (v_n >= 3, 'o expurgo apaga as encerradas com mais de 30 dias', v_n::text);
  begin
    perform public.outbox_purge(interval '7 days');
    insert into r values (false, 'retenção abaixo de 30 dias é recusada (22023)', 'aceitou');
  exception when sqlstate '22023' then insert into r values (true, 'retenção abaixo de 30 dias é recusada (22023)', null); end;
end
$$;
reset role;
insert into r values (
  not exists (select 1 from public.event_outbox where event_key in ('purge-sent-velha', 'purge-skipped-velha', 'purge-dead-velha')),
  'sent, skipped e dead_letter velhas saíram', null);
insert into r values (
  (select pg_catalog.count(*) from public.event_outbox where event_key in ('purge-sent-recente', 'purge-pending-velha', 'purge-retry-velha')) = 3,
  'a recente e as que ainda vão sair (pending, retry) ficam', null);
insert into r values (not pg_catalog.has_function_privilege('anon', 'public.outbox_purge(interval)', 'execute'), 'anon não expurga', null);
insert into r values (not pg_catalog.has_function_privilege('authenticated', 'public.outbox_purge(interval)', 'execute'), 'authenticated não expurga', null);

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes de event_outbox falharam: %', v_falhas;
  end if;
  raise notice 'testes de event_outbox: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
