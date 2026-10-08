-- ============================================================================
-- Testes de job_leases (20261008130000 · Fase 6). Rodados por
-- scripts/db-local-test.sh, em ROLLBACK. O preparo que o app não faz (expirar o
-- lease à mão) roda como postgres; o resto, como service_role (o worker).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;

-- 1-2. service_role pega o lease livre; a 2ª vez (ainda travado) não pega.
set role service_role;
do $$
declare v1 jsonb; v2 jsonb;
begin
  v1 := public.job_claim('t', 300);
  v2 := public.job_claim('t', 300);
  insert into r values ((v1->>'claimed')::boolean, 'job_claim pega o lease livre', v1::text);
  insert into r values ((v2->>'claimed')::boolean = false,
    'job_claim NÃO pega o lease travado', v2::text);
  perform public.job_cursor_set('t', 'abc');
end
$$;
reset role;

-- 3. service_role NÃO toca a tabela direto (só pelas RPCs).
set role service_role;
do $$
begin
  perform pg_catalog.count(*) from public.job_leases;
  insert into r values (false, 'service_role NÃO lê job_leases direto', 'leu sem erro');
exception when insufficient_privilege then
  insert into r values (true, 'service_role NÃO lê job_leases direto', 'barrado (ok)');
end
$$;
reset role;

-- Expira o lease à mão (o que o worker não faz; só o tempo faria).
update public.job_leases set locked_until = pg_catalog.to_timestamp(0) where name = 't';

-- 4. Expirado, re-pega e devolve o cursor salvo.
set role service_role;
do $$
declare v3 jsonb;
begin
  v3 := public.job_claim('t', 300);
  insert into r values (
    (v3->>'claimed')::boolean and v3->>'cursor' = 'abc',
    'job_claim re-pega após expirar e devolve o cursor', v3::text);
end
$$;
reset role;

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes de job_leases falharam: %', v_falhas;
  end if;
  raise notice 'testes de job_leases: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
