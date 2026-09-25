-- ============================================================================
-- Testes de ensure_chat_integration_secret (20260925120600). Rodados por
-- scripts/db-local-test.sh; tudo em ROLLBACK.
--
-- A corrida real (duas sessões) foi provada à mão na revisão da Fase 2 e está
-- no PROGRESS; aqui ficam os contratos de uma sessão só.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role, authenticated;

set role service_role;

do $$
declare
  v_int uuid;
  v_t text;
  v_n int;
begin
  insert into public.chat_integrations (name, provider, config)
  values ('teste', 'uazapi', '{"apiUrl":"https://x.test"}') returning id into v_int;

  v_t := public.ensure_chat_integration_secret(v_int, 'webhook_secret', 'primeiro');
  insert into r values (v_t = 'primeiro', 'S01 sem segredo grava o candidato', v_t);

  v_t := public.ensure_chat_integration_secret(v_int, 'webhook_secret', 'segundo');
  insert into r values (v_t = 'primeiro', 'S02 com segredo devolve o existente', v_t);

  v_t := public.get_chat_integration_secret(v_int, 'webhook_secret');
  insert into r values (v_t = 'primeiro', 'S03 o Vault guarda o primeiro', v_t);

  select count(*) into v_n from vault.secrets
   where name = 'crm_suporte_chat_integration.' || v_int::text || '.webhook_secret';
  insert into r values (v_n = 1, 'S04 um segredo só no Vault', v_n::text);

  begin
    perform public.ensure_chat_integration_secret(gen_random_uuid(), 'webhook_secret', 'x');
    insert into r values (false, 'S05 integração inexistente', 'passou');
  exception when sqlstate 'P0002' then insert into r values (true, 'S05 integração inexistente', sqlerrm); end;

  begin
    perform public.ensure_chat_integration_secret(v_int, 'senha', 'x');
    insert into r values (false, 'S06 tipo desconhecido', 'passou');
  exception when sqlstate '22023' then insert into r values (true, 'S06 tipo desconhecido', sqlerrm); end;
end $$;

reset role;

do $$
begin
  insert into r values (
    not pg_catalog.has_function_privilege('anon', 'public.ensure_chat_integration_secret(uuid,text,text)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.ensure_chat_integration_secret(uuid,text,text)', 'EXECUTE'),
    'S07 anon e authenticated sem EXECUTE', '');
end $$;

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select string_agg(teste, '; ' order by teste) into v_falhas from r where not ok;
  if v_falhas is not null then
    raise exception 'testes de segredo da integração falharam: %', v_falhas;
  end if;
  raise notice 'testes de segredo da integração: % caso(s), todos ok', (select count(*) from r);
end $$;

rollback;
