-- ============================================================================
-- Testes do histórico de conexão do WhatsApp (20261009120000). Rodados por
-- scripts/db-local-test.sh, em ROLLBACK. O setup (uma integração) roda como
-- postgres; a escrita e os checks, como service_role (o app).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;
create temp table ids (integ uuid, evento uuid) on commit drop;
grant all on ids to service_role;

-- O provedor é único em chat_integrations: num banco local que já tem a
-- integração, reaproveita (tudo volta no ROLLBACK); no CI (banco vazio), cria.
do $$
declare v_integ uuid;
begin
  select id into v_integ from public.chat_integrations where provider = 'uazapi' limit 1;
  if v_integ is null then
    insert into public.chat_integrations (name, provider, config, is_active)
      values ('Teste monitor', 'uazapi', '{"apiUrl":"https://exemplo.invalid"}'::jsonb, false)
      returning id into v_integ;
  end if;
  insert into ids (integ) values (v_integ);
end
$$;

set role service_role;
do $$
declare v_integ uuid; v_evento uuid; v_lidos integer;
begin
  select integ into v_integ from ids;

  insert into public.chat_connection_events (integration_id, state, reason, source)
    values (v_integ, 'close', 'logout', 'poll') returning id into v_evento;
  update ids set evento = v_evento;
  insert into r values (v_evento is not null, 'service_role acrescenta uma mudança de estado', null);

  select pg_catalog.count(*) into v_lidos from public.chat_connection_events where id = v_evento;
  insert into r values (v_lidos = 1, 'service_role lê o histórico', v_lidos::text);

  begin
    update public.chat_connection_events set state = 'open' where id = v_evento;
    insert into r values (false, 'service_role NÃO altera o histórico', 'alterou');
  exception when insufficient_privilege then insert into r values (true, 'service_role NÃO altera o histórico', 'ok'); end;

  begin
    delete from public.chat_connection_events where id = v_evento;
    insert into r values (false, 'service_role NÃO apaga o histórico', 'apagou');
  exception when insufficient_privilege then insert into r values (true, 'service_role NÃO apaga o histórico', 'ok'); end;

  begin
    insert into public.chat_connection_events (integration_id, state, source) values (v_integ, 'conectado', 'poll');
    insert into r values (false, 'estado fora do vocabulário recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'estado fora do vocabulário recusado', 'ok'); end;

  begin
    insert into public.chat_connection_events (integration_id, state, source) values (v_integ, 'open', 'manual');
    insert into r values (false, 'origem fora do vocabulário recusada', 'aceitou');
  exception when check_violation then insert into r values (true, 'origem fora do vocabulário recusada', 'ok'); end;

  begin
    insert into public.chat_connection_events (integration_id, state, reason, source) values (v_integ, 'close', '   ', 'poll');
    insert into r values (false, 'motivo em branco recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'motivo em branco recusado', 'ok'); end;
end
$$;
reset role;

-- anon e authenticated não alcançam a tabela.
insert into r values (
  not pg_catalog.has_table_privilege('anon', 'public.chat_connection_events', 'select'),
  'anon não lê o histórico', null);
insert into r values (
  not pg_catalog.has_table_privilege('authenticated', 'public.chat_connection_events', 'select'),
  'authenticated não lê o histórico', null);

-- Apagar a integração leva o histórico junto (ON DELETE CASCADE).
insert into r values (
  (select confdeltype from pg_constraint where conname = 'chat_connection_events_integration_id_fkey') = 'c',
  'integration_id é ON DELETE CASCADE', null);

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes do histórico de conexão falharam: %', v_falhas;
  end if;
  raise notice 'testes do histórico de conexão: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
