-- ============================================================================
-- Testes da fundação da API v1 (20260929170000): tipo do token (ai|api) na
-- autoria e na origem do ticket, Idempotency-Key (begin/finish/release/purge)
-- e retenção de integration_logs. Rodados por scripts/db-local-test.sh; tudo
-- em ROLLBACK.
--
-- O preparo roda como postgres; os casos, como service_role (o papel do app).
-- Volta a postgres só para o que o app não faz: chamar o helper interno
-- require_ticket_actor e "passar o tempo" (lease e validade vencidas).
--
-- Não coberto aqui, porque exige duas sessões: dois begin simultâneos com a
-- mesma chave nova (o 2º espera o índice único e sai in_progress), e a
-- linha apagada entre o INSERT e o SELECT do begin (o laço tenta de novo).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
create temp table ids (k text primary key, id uuid not null) on commit drop;
grant all on r, ids to service_role;

create function pg_temp.id(p_k text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  select i.id into v_id from ids i where i.k = p_k;
  if v_id is null then
    raise exception 'api.sql: id % ausente', p_k;
  end if;
  return v_id;
end
$$;

create function pg_temp.new_conv(p_n integer) returns uuid
language plpgsql as $$
declare
  v_phone   text := '55119900008' || lpad(p_n::text, 2, '0');
  v_contact uuid;
  v_id      uuid;
begin
  v_contact := (public.resolve_contact_identity(v_phone, 'Contato API ' || p_n, 'whatsapp', null, false) ->> 'contactId')::uuid;
  insert into public.chat_conversations (integration_id, contact_id, external_id, contact_phone, contact_name)
  values (pg_temp.id('integration'), v_contact, v_phone, v_phone, 'Contato API ' || p_n)
  returning id into v_id;
  return v_id;
end
$$;

grant execute on function pg_temp.id(text) to service_role;

-- ---------------------------------------------------------------------------
-- Preparo (postgres)
-- ---------------------------------------------------------------------------
insert into public.chat_integrations (name, provider, config)
values ('Teste API', 'uazapi', '{"apiUrl":"https://x.test"}')
on conflict (provider) do nothing;
insert into ids select 'integration', i.id from public.chat_integrations i where i.provider = 'uazapi';

with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, scopes, actor_type)
  values ('IA de triagem', md5(random()::text) || md5(random()::text), 'crmsuporte_ia', '{tickets:*}', 'ai')
  returning id
) insert into ids select 'token_ai', id from t;
with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, scopes)
  values ('Integração', md5(random()::text) || md5(random()::text), 'crmsuporte_ap', '{tickets:*}')
  returning id
) insert into ids select 'token_api', id from t;

insert into ids values ('conv_1', pg_temp.new_conv(1)), ('conv_2', pg_temp.new_conv(2)),
                       ('conv_3', pg_temp.new_conv(3));

-- ---------------------------------------------------------------------------
-- A. Tipo do token (postgres: require_ticket_actor é helper interno)
-- ---------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  select t.actor_type into v_t from public.api_tokens t where t.id = pg_temp.id('token_api');
  insert into r values (v_t = 'api', 'A01 token sem tipo nasce api', v_t);

  begin
    update public.api_tokens set actor_type = 'robo' where id = pg_temp.id('token_api');
    insert into r values (false, 'A02 tipo fora de ai|api é recusado', 'passou');
  exception when check_violation then insert into r values (true, 'A02 tipo fora de ai|api é recusado', sqlerrm); end;

  v_t := public.require_ticket_actor(null, pg_temp.id('token_ai'));
  insert into r values (v_t = 'ai', 'A03 require_ticket_actor devolve ai para o token da IA', v_t);
  v_t := public.require_ticket_actor(null, pg_temp.id('token_api'));
  insert into r values (v_t = 'api', 'A04 require_ticket_actor devolve api para o token de integração', v_t);
end $$;

set role service_role;

-- ---------------------------------------------------------------------------
-- B. Origem do ticket vem do tipo do token
-- ---------------------------------------------------------------------------
do $$
declare
  j   jsonb;
  v_s text;
  v_e text;
begin
  j := public.create_ticket(p_conversation_id => pg_temp.id('conv_1'), p_title => 'Aberto pela IA',
                            p_actor_token_id => pg_temp.id('token_ai'));
  select t.source into v_s from public.tickets t where t.id = (j -> 'ticket' ->> 'id')::uuid;
  insert into r values (v_s = 'ai', 'B01 token da IA sem p_source abre ticket com origem ai', v_s);

  select e.actor_type into v_e from public.ticket_events e
   where e.ticket_id = (j -> 'ticket' ->> 'id')::uuid order by e.seq limit 1;
  insert into r values (v_e = 'ai', 'B02 o evento de abertura é da IA', v_e);

  j := public.create_ticket(p_conversation_id => pg_temp.id('conv_2'), p_title => 'IA confirmando',
                            p_actor_token_id => pg_temp.id('token_ai'), p_source => 'ai');
  select t.source into v_s from public.tickets t where t.id = (j -> 'ticket' ->> 'id')::uuid;
  insert into r values (v_s = 'ai', 'B03 p_source igual ao tipo do token é aceito', v_s);

  begin
    perform public.create_ticket(p_conversation_id => pg_temp.id('conv_3'), p_title => 'Integração se passando por IA',
                                 p_actor_token_id => pg_temp.id('token_api'), p_source => 'ai');
    insert into r values (false, 'B04 token api com p_source ai é INVALID_SOURCE', 'passou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_SOURCE', 'B04 token api com p_source ai é INVALID_SOURCE', sqlerrm);
  end;

  begin
    perform public.create_ticket(p_conversation_id => pg_temp.id('conv_3'), p_title => 'IA se passando por integração',
                                 p_actor_token_id => pg_temp.id('token_ai'), p_source => 'api');
    insert into r values (false, 'B06 token ai com p_source api é INVALID_SOURCE', 'passou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_SOURCE', 'B06 token ai com p_source api é INVALID_SOURCE', sqlerrm);
  end;

  j := public.create_ticket(p_conversation_id => pg_temp.id('conv_3'), p_title => 'Integração',
                            p_actor_token_id => pg_temp.id('token_api'));
  select t.source into v_s from public.tickets t where t.id = (j -> 'ticket' ->> 'id')::uuid;
  insert into r values (v_s = 'api', 'B05 token api sem p_source abre com origem api', v_s);
end $$;

-- ---------------------------------------------------------------------------
-- I. Idempotency-Key (service_role: o app não lê a tabela; o efeito se prova
--    pelo begin seguinte). `route` é o caminho concreto.
-- ---------------------------------------------------------------------------
create temp table att (k text primary key, id uuid not null) on commit drop;
grant all on att to service_role;

do $$
declare
  j      jsonb;
  v_tok  uuid := pg_temp.id('token_api');
  v_hash text := repeat('a', 64);
  v_a    uuid;
  c_r    constant text := '/api/v1/tickets';
begin
  j := public.api_idempotency_begin(v_tok, 'chave-0001', 'POST', c_r, v_hash);
  v_a := (j ->> 'attempt_id')::uuid;
  insert into r values (j ->> 'outcome' = 'started' and v_a is not null, 'I01 chave nova começa e devolve attempt_id', j::text);

  j := public.api_idempotency_begin(v_tok, 'chave-0001', 'POST', c_r, v_hash);
  insert into r values (j ->> 'outcome' = 'in_progress', 'I02 mesma chave em curso é in_progress', j::text);

  j := public.api_idempotency_begin(v_tok, 'chave-0001', 'POST', c_r, repeat('b', 64));
  insert into r values (j ->> 'outcome' = 'reused', 'I03 corpo diferente é reused (mesmo em curso)', j::text);

  begin
    perform public.api_idempotency_finish(v_tok, 'chave-0001', gen_random_uuid(), 201::smallint, '{}');
    insert into r values (false, 'I04 outra tentativa não conclui a chave (P0002)', 'passou');
  exception when sqlstate 'P0002' then insert into r values (true, 'I04 outra tentativa não conclui a chave (P0002)', sqlerrm); end;

  perform public.api_idempotency_release(v_tok, 'chave-0001', gen_random_uuid());
  j := public.api_idempotency_begin(v_tok, 'chave-0001', 'POST', c_r, v_hash);
  insert into r values (j ->> 'outcome' = 'in_progress', 'I05 outra tentativa não libera a chave', j::text);

  perform public.api_idempotency_finish(v_tok, 'chave-0001', v_a, 201::smallint, '{"ok":true,"id":"t1"}');
  j := public.api_idempotency_begin(v_tok, 'chave-0001', 'POST', c_r, v_hash);
  insert into r values (j ->> 'outcome' = 'replay' and (j ->> 'status')::int = 201 and j -> 'body' ->> 'id' = 't1'
                        and not (j ? 'attempt_id'),
                        'I06 concluída repete status e corpo', j::text);

  j := public.api_idempotency_begin(v_tok, 'chave-0001', 'POST', '/api/v1/contacts', v_hash);
  insert into r values (j ->> 'outcome' = 'reused', 'I07 mesma chave em outra rota é reused', j::text);

  -- Mesmo corpo e mesma chave em OUTRO recurso: reuso, não a resposta alheia.
  j := public.api_idempotency_begin(v_tok, 'chave-0009', 'POST',
         '/api/v1/tickets/11111111-1111-4111-8111-111111111111/comments', v_hash);
  perform public.api_idempotency_finish(v_tok, 'chave-0009', (j ->> 'attempt_id')::uuid, 201::smallint, '{"id":"c-A"}');
  j := public.api_idempotency_begin(v_tok, 'chave-0009', 'POST',
         '/api/v1/tickets/22222222-2222-4222-8222-222222222222/comments', v_hash);
  insert into r values (j ->> 'outcome' = 'reused', 'I08 mesma chave e corpo em outro ticket é reused, não replay', j::text);

  j := public.api_idempotency_begin(pg_temp.id('token_ai'), 'chave-0001', 'POST', c_r, v_hash);
  insert into r values (j ->> 'outcome' = 'started', 'I09 a chave é por token: outro token começa do zero', j::text);

  -- release da tentativa dona: a chave volta a valer.
  j := public.api_idempotency_begin(v_tok, 'chave-0002', 'POST', c_r, v_hash);
  perform public.api_idempotency_release(v_tok, 'chave-0002', (j ->> 'attempt_id')::uuid);
  j := public.api_idempotency_begin(v_tok, 'chave-0002', 'POST', c_r, repeat('c', 64));
  insert into r values (j ->> 'outcome' = 'started', 'I10 depois do release a chave vale de novo (até com outro corpo)', j::text);

  -- release não apaga o que já concluiu.
  perform public.api_idempotency_release(v_tok, 'chave-0001', v_a);
  j := public.api_idempotency_begin(v_tok, 'chave-0001', 'POST', c_r, v_hash);
  insert into r values (j ->> 'outcome' = 'replay', 'I11 release não apaga a concluída', j::text);
end $$;

do $$
declare
  j     jsonb;
  v_tok uuid := pg_temp.id('token_api');
  v_a   uuid;
begin
  j := public.api_idempotency_begin(v_tok, 'chave-0003', 'POST', '/api/v1/tickets', repeat('d', 64));
  v_a := (j ->> 'attempt_id')::uuid;
  insert into att values ('chave-0003', v_a);
  begin
    perform public.api_idempotency_finish(v_tok, 'chave-0003', v_a, 500::smallint, '{}');
    insert into r values (false, 'I12 5xx não é guardado (check)', 'passou');
  exception when check_violation then insert into r values (true, 'I12 5xx não é guardado (check)', sqlerrm); end;

  begin
    perform public.api_idempotency_finish(v_tok, 'chave-0003', v_a, null::smallint, '{}');
    insert into r values (false, 'I13 status nulo é recusado', 'passou');
  exception when sqlstate '22023' then insert into r values (true, 'I13 status nulo é recusado', sqlerrm); end;

  begin
    perform public.api_idempotency_finish(v_tok, 'chave-inexistente', v_a, 201::smallint, '{}');
    insert into r values (false, 'I14 finish sem begin é P0002', 'passou');
  exception when sqlstate 'P0002' then insert into r values (true, 'I14 finish sem begin é P0002', sqlerrm); end;

  perform public.api_idempotency_finish(v_tok, 'chave-0003', v_a, 422::smallint, '{"ok":false}');
  insert into r values (
    public.api_idempotency_begin(v_tok, 'chave-0003', 'POST', '/api/v1/tickets', repeat('d', 64)) ->> 'status' = '422',
    'I15 422 é guardado e repetido', '');

  begin
    perform public.api_idempotency_begin(v_tok, 'curta', 'POST', '/api/v1/tickets', repeat('d', 64));
    insert into r values (false, 'I16 chave fora do formato é recusada', 'passou');
  exception when check_violation then insert into r values (true, 'I16 chave fora do formato é recusada', sqlerrm); end;

  begin
    perform public.api_idempotency_begin(v_tok, 'chave-0004', 'POST', '/api/v1/tickets', 'nao-e-hash');
    insert into r values (false, 'I17 hash fora do formato é recusado', 'passou');
  exception when check_violation then insert into r values (true, 'I17 hash fora do formato é recusado', sqlerrm); end;

  begin
    perform public.api_idempotency_begin(v_tok, 'chave-0004', 'POST', '/api/v1/tickets', repeat('d', 64), 0);
    insert into r values (false, 'I18 lease fora de 5..3600 s é recusada', 'passou');
  exception when sqlstate '22023' then insert into r values (true, 'I18 lease fora de 5..3600 s é recusada', sqlerrm); end;

  j := public.api_idempotency_begin(v_tok, 'chave-0005', 'POST', '/api/v1/tickets', repeat('e', 64));
  insert into att values ('chave-0005', (j ->> 'attempt_id')::uuid);
end $$;

-- Tempo (postgres): lease vencida e chave vencida; aqui a tabela é legível.
reset role;
do $$
declare
  j     jsonb;
  v_tok uuid := pg_temp.id('token_api');
  v_old uuid := (select a.id from att a where a.k = 'chave-0005');
  v_new uuid;
  v_n   integer;
begin
  -- A chave nasce perto do fim da validade e a lease vence: quem assume leva
  -- a validade junto (nunca termina antes da lease).
  update public.api_idempotency_keys
     set locked_until = now() - interval '1 second', expires_at = now() + interval '10 seconds'
   where api_token_id = v_tok and idempotency_key = 'chave-0005';
  j := public.api_idempotency_begin(v_tok, 'chave-0005', 'POST', '/api/v1/tickets', repeat('e', 64));
  v_new := (j ->> 'attempt_id')::uuid;
  insert into r values (
    j ->> 'outcome' = 'started' and v_new <> v_old
    and exists (select 1 from public.api_idempotency_keys k
                 where k.api_token_id = v_tok and k.idempotency_key = 'chave-0005'
                   and k.attempt_id = v_new and k.locked_until > now() and k.expires_at >= k.locked_until),
    'I19 lease vencida: a nova tentativa assume, com attempt_id e validade próprios', j::text);

  j := public.api_idempotency_begin(v_tok, 'chave-0005', 'POST', '/api/v1/tickets', repeat('e', 64));
  insert into r values (j ->> 'outcome' = 'in_progress', 'I20 depois de assumir, a lease é de quem assumiu', j::text);

  begin
    perform public.api_idempotency_finish(v_tok, 'chave-0005', v_old, 201::smallint, '{}');
    insert into r values (false, 'I21 a tentativa que perdeu a lease não conclui', 'passou');
  exception when sqlstate 'P0002' then insert into r values (true, 'I21 a tentativa que perdeu a lease não conclui', sqlerrm); end;
  perform public.api_idempotency_release(v_tok, 'chave-0005', v_old);
  insert into r values (
    exists (select 1 from public.api_idempotency_keys k
             where k.api_token_id = v_tok and k.idempotency_key = 'chave-0005' and k.attempt_id = v_new),
    'I22 a tentativa que perdeu a lease não libera a da seguinte', '');

  -- Chave concluída e vencida: vale de novo, como nova (a linha é reescrita).
  update public.api_idempotency_keys set expires_at = now() - interval '1 second'
   where api_token_id = v_tok and idempotency_key = 'chave-0001';
  j := public.api_idempotency_begin(v_tok, 'chave-0001', 'POST', '/api/v1/contacts', repeat('f', 64));
  insert into r values (
    j ->> 'outcome' = 'started'
    and exists (select 1 from public.api_idempotency_keys k
                 where k.api_token_id = v_tok and k.idempotency_key = 'chave-0001'
                   and k.route = '/api/v1/contacts' and k.request_hash = repeat('f', 64)
                   and k.state = 'in_progress' and k.response_status is null and k.response_body is null
                   and k.attempt_id = (j ->> 'attempt_id')::uuid and k.expires_at > now()),
    'I23 chave vencida vale de novo, como nova', j::text);

  -- purge: só as vencidas.
  update public.api_idempotency_keys set expires_at = now() - interval '1 second'
   where api_token_id = v_tok and idempotency_key = 'chave-0003';
  v_n := public.api_idempotency_purge();
  insert into r values (
    v_n >= 1
    and not exists (select 1 from public.api_idempotency_keys where api_token_id = v_tok and idempotency_key = 'chave-0003')
    and (select count(*) from public.api_idempotency_keys
          where api_token_id = v_tok and idempotency_key in ('chave-0001', 'chave-0002', 'chave-0005', 'chave-0009')) = 4
    and exists (select 1 from public.api_idempotency_keys where api_token_id = pg_temp.id('token_ai')),
    'I24 purge apaga só as vencidas', v_n::text);

  -- Retenção de integration_logs.
  insert into public.integration_logs (provider, direction, created_at)
  values ('api_v1', 'inbound', now() - interval '91 days'), ('api_v1', 'inbound', now() - interval '1 day');
  v_n := public.purge_integration_logs();
  insert into r values (
    v_n >= 1
    and not exists (select 1 from public.integration_logs where created_at < now() - interval '90 days')
    and exists (select 1 from public.integration_logs where provider = 'api_v1' and created_at > now() - interval '2 days'),
    'L01 purge_integration_logs apaga só o que passou de 90 dias', v_n::text);

  begin
    perform public.purge_integration_logs(interval '89 days');
    insert into r values (false, 'L02 retenção abaixo de 90 dias (D9) é recusada', 'passou');
  exception when sqlstate '22023' then insert into r values (true, 'L02 retenção abaixo de 90 dias (D9) é recusada', sqlerrm); end;
end $$;

-- ---------------------------------------------------------------------------
-- P. Privilégios
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.api_idempotency_begin(uuid,text,text,text,text,integer)',
    'public.api_idempotency_finish(uuid,text,uuid,smallint,jsonb)',
    'public.api_idempotency_release(uuid,text,uuid)',
    'public.api_idempotency_purge()',
    'public.purge_integration_logs(interval)'
  ] loop
    insert into r values (
      pg_catalog.has_function_privilege('service_role', f, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', f, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'),
      'P01 só o service_role executa ' || f, '');
  end loop;

  insert into r values (
    not pg_catalog.has_any_column_privilege('service_role', 'public.api_idempotency_keys', 'SELECT, INSERT, UPDATE, REFERENCES')
    and not pg_catalog.has_table_privilege('service_role', 'public.api_idempotency_keys', 'DELETE, TRUNCATE'),
    'P02 api_idempotency_keys só pelas RPCs (nem o service_role toca a tabela)', '');

  insert into r values (
    not pg_catalog.has_function_privilege('service_role', 'public.require_ticket_actor(uuid,uuid)', 'EXECUTE'),
    'P03 require_ticket_actor segue helper interno', '');

  insert into r values (
    pg_catalog.has_column_privilege('service_role', 'public.api_tokens', 'actor_type', 'UPDATE')
    and pg_catalog.has_column_privilege('service_role', 'public.api_tokens', 'actor_type', 'INSERT'),
    'P04 o app grava e edita o tipo do token', '');
end $$;

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select string_agg(teste, '; ' order by teste) into v_falhas from r where not ok;
  if v_falhas is not null then
    raise exception 'testes da API v1 falharam: %', v_falhas;
  end if;
  raise notice 'testes da API v1: % caso(s), todos ok', (select count(*) from r);
end $$;

rollback;
