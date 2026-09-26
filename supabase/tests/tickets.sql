-- ============================================================================
-- Testes de tickets (20260925120900): catálogo e porta de escrita, abertura e
-- idempotência, carimbo e foco, 1ª resposta, transição e SLA, edição,
-- atribuição e "Assumir", retomada por inbound, chat e usuários, satélites, a
-- view ticket_queue e a ordem dos triggers. Rodados por scripts/db-local-test.sh;
-- tudo em ROLLBACK.
--
-- O preparo roda como postgres; os casos, como service_role. Volta a postgres
-- (reset role) só o que o app não faz: provar que nem o dono fura o guard e a
-- trilha (T07, T10, T21) e simular o tempo.
--
-- Tempo: a transação inteira tem um now() só. Para "passar o tempo", o ticket
-- inteiro recua (pg_temp.shift_ticket; em session_replication_role = replica,
-- porque guard_ticket_update barra created_at até para o dono) e os carimbos
-- sla_paused_at/resolved_at recuam por UPDATE direto (o guard deixa, e a
-- versão não sobe). Os CHECKs valem nos dois caminhos.
--
-- Não coberto aqui, porque exige duas sessões: as corridas R1–R5 (abertura ×
-- inbound, dois "Assumir", transição × retomada, cancelar × inbound e rename ×
-- inbound × "Assumir"). A prova é manual, com duas sessões psql, e o resultado
-- vai para o PROGRESS.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
-- Ids que atravessam os blocos: cada troca de papel abre um bloco novo.
create temp table ids (k text primary key, id uuid not null) on commit drop;
grant all on r, ids to service_role;

-- ---------------------------------------------------------------------------
-- Helpers de sessão. Função nova do postgres nasce sem EXECUTE para PUBLIC
-- (default privileges do projeto): o grant é explícito.
-- ---------------------------------------------------------------------------
create function pg_temp.id(p_k text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  select i.id into v_id from ids i where i.k = p_k;
  if v_id is null then
    raise exception 'tickets.sql: id % ausente', p_k;
  end if;
  return v_id;
end
$$;

create function pg_temp.ver(p_ticket uuid) returns integer
language sql as $$
  select t.version from public.tickets t where t.id = p_ticket
$$;

-- Mensagem como o app grava (papel corrente). O ticket_id informado prova que
-- o carimbo o ignora.
create function pg_temp.msg(
  p_conv   uuid,
  p_dir    text,
  p_sender text,
  p_status text,
  p_at     timestamptz default now(),
  p_type   text default 'text',
  p_ticket uuid default null
) returns uuid
language sql as $$
  insert into public.chat_messages (
    conversation_id, direction, sender_type, type, content, delivery_status, created_at, ticket_id
  ) values (p_conv, p_dir, p_sender, p_type, 'mensagem de teste', p_status, p_at, p_ticket)
  returning id
$$;

-- null se p_sql falhou com p_state (e, se dado, com a mensagem ou a
-- constraint p_what); senão, o que aconteceu. Roda com o papel corrente.
create function pg_temp.fails(p_sql text, p_state text, p_what text default null)
returns text
language plpgsql as $$
declare
  v_c text;
begin
  execute p_sql;
  return 'passou';
exception when others then
  get stacked diagnostics v_c = constraint_name;
  if sqlstate = p_state and (p_what is null or p_what in (sqlerrm, v_c)) then
    return null;
  end if;
  return sqlstate || ' ' || sqlerrm || coalesce(' [' || nullif(v_c, '') || ']', '');
end
$$;

create function pg_temp.expect_fail(p_teste text, p_sql text, p_state text, p_what text default null)
returns void
language plpgsql as $$
declare
  v_res text := pg_temp.fails(p_sql, p_state, p_what);
begin
  insert into r values (v_res is null, p_teste, coalesce(v_res, p_state || coalesce(' ' || p_what, '')));
end
$$;

-- Só postgres: o ticket "foi aberto" p_by atrás, com tudo o que já aconteceu.
create function pg_temp.shift_ticket(p_ticket uuid, p_by interval) returns void
language plpgsql as $$
begin
  set local session_replication_role = replica;
  update public.tickets t
     set created_at            = t.created_at - p_by,
         updated_at            = t.updated_at - p_by,
         first_response_due_at = t.first_response_due_at - p_by,
         resolution_due_at     = t.resolution_due_at - p_by,
         first_responded_at    = t.first_responded_at - p_by,
         first_ai_response_at  = t.first_ai_response_at - p_by,
         sla_paused_at         = t.sla_paused_at - p_by,
         resolved_at           = t.resolved_at - p_by,
         closed_at             = t.closed_at - p_by
   where t.id = p_ticket;
  if not found then
    raise exception 'tickets.sql: ticket % inexistente', p_ticket;
  end if;
  set local session_replication_role = origin;
end
$$;

create function pg_temp.new_conv(p_n integer) returns uuid
language plpgsql as $$
declare
  v_phone   text := '55119900007' || lpad(p_n::text, 2, '0');
  v_name    text := 'Contato Ticket ' || lpad(p_n::text, 2, '0');
  v_contact uuid;
  v_id      uuid;
begin
  v_contact := (public.resolve_contact_identity(v_phone, v_name, 'whatsapp', null, false) ->> 'contactId')::uuid;
  insert into public.chat_conversations (integration_id, contact_id, external_id, contact_phone, contact_name)
  values (pg_temp.id('integration'), v_contact, v_phone, v_phone, v_name)
  returning id into v_id;
  return v_id;
end
$$;

grant execute on function pg_temp.id(text), pg_temp.ver(uuid),
  pg_temp.msg(uuid, text, text, text, timestamptz, text, uuid),
  pg_temp.expect_fail(text, text, text, text)
  to service_role;
grant execute on function pg_temp.fails(text, text, text) to service_role, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Preparo (postgres)
-- ---------------------------------------------------------------------------

-- Isola dos dados de dev (volta no ROLLBACK): libera os nomes de fila dos casos.
update public.products set archived_at = now()
 where lower(btrim(name)) in ('fila tickets alfa', 'fila tickets beta', 'fila tickets arquivada',
                              'fila tickets gama', 'fila tickets gama renomeada')
   and archived_at is null;

-- A instância é única (provider único): reusa a de dev, se houver.
insert into public.chat_integrations (name, provider, config)
values ('Teste Tickets', 'uazapi', '{"apiUrl":"https://x.test"}')
on conflict (provider) do nothing;
insert into ids select 'integration', i.id from public.chat_integrations i where i.provider = 'uazapi';

-- Usuários: admin, duas analistas, um inativo e quem vai ser excluído (T83).
insert into ids
select 'admin', id from public.create_app_user('tk-admin@x.test', 'Admin Tickets', '12345678', 'admin', 'slate');
insert into ids
select 'ana', id from public.create_app_user('tk-ana@x.test', 'Analista Ana', '12345678', 'member', 'slate');
insert into ids
select 'bia', id from public.create_app_user('tk-bia@x.test', 'Analista Bia', '12345678', 'member', 'slate');
insert into ids
select 'inactive', id from public.create_app_user('tk-inativo@x.test', 'Analista Inativo', '12345678', 'member', 'slate');
update public.app_users set is_active = false where id = pg_temp.id('inactive');
insert into ids
select 'leaver', id from public.create_app_user('tk-saida@x.test', 'Analista de Saída', '12345678', 'member', 'slate');

-- Tokens: vigente, revogado e vencido.
with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, created_by)
  values ('Tickets vigente', md5(random()::text) || md5(random()::text), 'crmsuporte_tk1', pg_temp.id('admin'))
  returning id
) insert into ids select 'token', id from t;
with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, created_by, revoked_at)
  values ('Tickets revogado', md5(random()::text) || md5(random()::text), 'crmsuporte_tk2', pg_temp.id('admin'), now())
  returning id
) insert into ids select 'token_revoked', id from t;
with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, created_by, expires_at)
  values ('Tickets vencido', md5(random()::text) || md5(random()::text), 'crmsuporte_tk3', pg_temp.id('admin'),
          now() - interval '1 hour')
  returning id
) insert into ids select 'token_expired', id from t;

-- Filas (uma arquivada) e uma categoria da fila Alfa.
with p as (insert into public.products (name) values ('Fila Tickets Alfa') returning id)
insert into ids select 'q1', id from p;
with p as (insert into public.products (name) values ('Fila Tickets Beta') returning id)
insert into ids select 'q2', id from p;
with p as (insert into public.products (name) values ('Fila Tickets Arquivada') returning id)
insert into ids select 'q_arch', id from p;
update public.products set archived_at = now() where id = pg_temp.id('q_arch');
with c as (
  insert into public.ticket_categories (name, product_id) values ('Categoria Alfa', pg_temp.id('q1')) returning id
) insert into ids select 'cat_q1', id from c;

-- Empresas: com contrato suspenso (vigente), com contrato ativo e arquivada.
with c as (insert into public.customers (legal_name) values ('Empresa Tickets Suspensa Ltda') returning id)
insert into ids select 'cu_sus', id from c;
with c as (insert into public.customers (legal_name) values ('Empresa Tickets Ativa Ltda') returning id)
insert into ids select 'cu_act', id from c;
with c as (insert into public.customers (legal_name) values ('Empresa Tickets Arquivada Ltda') returning id)
insert into ids select 'cu_arch', id from c;
update public.customers set archived_at = now() where id = pg_temp.id('cu_arch');
insert into ids values
  ('k_sus', public.create_support_contract(pg_temp.id('admin'), pg_temp.id('cu_sus'), 'suspenso',
     (now() at time zone 'America/Sao_Paulo')::date - 30, 100, 10, array[pg_temp.id('q1')])),
  ('k_act', public.create_support_contract(pg_temp.id('admin'), pg_temp.id('cu_act'), 'ativo',
     (now() at time zone 'America/Sao_Paulo')::date - 30, 200, 10, array[pg_temp.id('q1')]));

-- Uma conversa (e um contato, 55119900007NN) por grupo de casos.
insert into ids
select 'c' || lpad(n::text, 2, '0'), pg_temp.new_conv(n)
  from unnest(array[5, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 30, 31, 40, 41, 43, 44, 45, 46,
                    60, 61, 62, 63, 70, 71, 80, 82, 83, 95]) as n;

-- O contato da conversa 11 é da empresa com contrato suspenso.
update public.contacts set customer_id = pg_temp.id('cu_sus')
 where id = (select c.contact_id from public.chat_conversations c where c.id = pg_temp.id('c11'));

-- ============================================================================
-- Catálogo e porta de escrita (T01–T08, T10)
-- ============================================================================
set role service_role;

do $$
declare
  v_ana    uuid := pg_temp.id('ana');
  v_c05    uuid := pg_temp.id('c05');
  v_tk05   uuid;
  v_tk10   uuid;
  v_m05    uuid;
  v_conv   uuid;
  v_active uuid;
  v_sql    text;
  v_tag    text;
  v_t      text;
  v_n      integer;
  v_n2     integer;
  v_n3     integer;
  j        jsonb;
begin
  -- T01
  select string_agg(format('%s:%s:%s', s.key, s.sla_mode, s.is_terminal), ',' order by s.position)
    into v_t
    from public.ticket_statuses s;
  insert into r values (
    v_t = 'novo:running:f,em_triagem:running:f,em_atendimento:running:f,'
          'aguardando_cliente:paused:f,aguardando_interno:running:f,'
          'resolvido:stopped:f,fechado:stopped:t,cancelado:stopped:t',
    'T01 8 status com sla_mode e is_terminal', v_t);

  -- T02
  select count(*) into v_n from public.ticket_status_transitions;
  select count(*) into v_n2
    from public.ticket_status_transitions tr
    join (values
      ('novo', 'em_triagem'), ('novo', 'em_atendimento'), ('novo', 'aguardando_cliente'),
      ('novo', 'aguardando_interno'), ('novo', 'cancelado'),
      ('em_triagem', 'em_atendimento'), ('em_triagem', 'aguardando_cliente'),
      ('em_triagem', 'aguardando_interno'), ('em_triagem', 'cancelado'),
      ('em_atendimento', 'aguardando_cliente'), ('em_atendimento', 'aguardando_interno'),
      ('em_atendimento', 'resolvido'), ('em_atendimento', 'cancelado'),
      ('aguardando_cliente', 'em_atendimento'), ('aguardando_cliente', 'aguardando_interno'),
      ('aguardando_cliente', 'resolvido'), ('aguardando_cliente', 'cancelado'),
      ('aguardando_interno', 'em_atendimento'), ('aguardando_interno', 'aguardando_cliente'),
      ('aguardando_interno', 'resolvido'), ('aguardando_interno', 'cancelado'),
      ('resolvido', 'em_atendimento'), ('resolvido', 'fechado')
    ) as m (f, t) on m.f = tr.from_status and m.t = tr.to_status;
  select count(*) into v_n3
    from public.ticket_status_transitions tr
    join public.ticket_statuses s on s.key = tr.from_status
   where s.is_terminal;
  select string_agg(tr.to_status, ',' order by tr.to_status) into v_t
    from public.ticket_status_transitions tr
   where tr.from_status = 'resolvido';
  insert into r values (v_n = 23 and v_n2 = 23 and v_n3 = 0 and v_t = 'em_atendimento,fechado',
    'T02 matriz de 23 pares; terminal sem saída; resolvido reabre ou fecha',
    format('%s par(es), %s da matriz, %s saída(s) de terminal, resolvido → %s', v_n, v_n2, v_n3, v_t));

  -- T03
  select string_agg(format('%s:%s:%s:%s:%s', p.priority, p.rank, p.first_response_minutes,
                           p.resolution_minutes, p.warn_pct), ',' order by p.rank)
    into v_t
    from public.sla_policies p;
  insert into r values (v_t = 'baixa:1:480:4320:80,media:2:240:1440:80,alta:3:60:480:80,critica:4:30:240:80',
    'T03a seed de sla_policies', v_t);
  perform pg_temp.expect_fail('T03b 1ª resposta maior que a solução',
    'update public.sla_policies set first_response_minutes = resolution_minutes + 1 where priority = ''media''',
    '23514', 'sla_policies_order_check');

  -- T04
  update public.ticket_statuses set label = 'Novo chamado', color = 'teal' where key = 'novo';
  select s.label || '|' || s.color into v_t from public.ticket_statuses s where s.key = 'novo';
  insert into r values (v_t = 'Novo chamado|teal', 'T04a service_role muda rótulo e cor', v_t);
  perform pg_temp.expect_fail('T04b sla_mode é do sistema',
    'update public.ticket_statuses set sla_mode = ''paused'' where key = ''novo''', '42501');
  perform pg_temp.expect_fail('T04c posição é do sistema',
    'update public.ticket_statuses set position = 15 where key = ''novo''', '42501');
  perform pg_temp.expect_fail('T04d rótulo repetido (sem caixa nem espaço)',
    'update public.ticket_statuses
        set label = (select '' '' || upper(s.label) || '' '' from public.ticket_statuses s where s.key = ''em_triagem'')
      where key = ''novo''',
    '23505', 'ticket_statuses_label_uidx');

  -- T05
  perform pg_temp.expect_fail('T05a INSERT em tickets negado',
    format('insert into public.tickets (title, priority, conversation_id, contact_id, source) '
           'values (''x'', ''media'', %L, gen_random_uuid(), ''agent'')', v_c05), '42501');
  perform pg_temp.expect_fail('T05b UPDATE em tickets negado', 'update public.tickets set title = ''x''', '42501');
  perform pg_temp.expect_fail('T05c DELETE em tickets negado', 'delete from public.tickets', '42501');
  begin
    perform count(*) from public.tickets;
    perform count(*) from public.ticket_queue;
    insert into r values (true, 'T05d SELECT em tickets e em ticket_queue', '');
  exception when others then
    insert into r values (false, 'T05d SELECT em tickets e em ticket_queue', sqlstate || ' ' || sqlerrm);
  end;

  -- Ticket em foco na conversa 05 e um segundo, fora do foco, em atendimento.
  j := public.create_ticket(p_conversation_id => v_c05, p_title => 'Porta de escrita', p_actor_user_id => v_ana);
  v_tk05 := (j #>> '{ticket,id}')::uuid;
  j := public.create_ticket(p_conversation_id => v_c05, p_title => 'Em atendimento', p_actor_user_id => v_ana,
         p_set_active => false);
  v_tk10 := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_tk10, 'em_atendimento', 1, v_ana);
  v_m05 := pg_temp.msg(v_c05, 'inbound', 'contact', 'delivered');
  insert into ids values ('tk05', v_tk05), ('tk10', v_tk10), ('m05', v_m05);

  -- T06
  perform pg_temp.expect_fail('T06a UPDATE de chat_messages.ticket_id negado',
    format('update public.chat_messages set ticket_id = null where id = %L', v_m05), '42501');
  perform pg_temp.expect_fail('T06b foco não muda por UPDATE do app',
    format('update public.chat_conversations set active_ticket_id = null where id = %L', v_c05),
    'P0001', 'ACTIVE_TICKET_READ_ONLY');
  perform pg_temp.expect_fail('T06c conversa não nasce com foco pelo app',
    format('insert into public.chat_conversations (integration_id, contact_id, external_id, contact_phone, active_ticket_id) '
           'select c.integration_id, c.contact_id, ''5511990000799'', ''5511990000799'', %L '
           'from public.chat_conversations c where c.id = %L', v_tk05, v_c05),
    'P0001', 'ACTIVE_TICKET_READ_ONLY');
  -- Molde do webhook (upsert-message.ts): DO UPDATE SET das colunas do corpo.
  insert into public.chat_conversations (integration_id, contact_id, external_id, contact_phone, updated_at, contact_name)
  select c.integration_id, c.contact_id, c.external_id, c.contact_phone, now(), 'Contato Ticket 05'
    from public.chat_conversations c
   where c.id = v_c05
  on conflict (integration_id, external_id) do update set
    integration_id = excluded.integration_id, contact_id = excluded.contact_id, external_id = excluded.external_id,
    contact_phone = excluded.contact_phone, updated_at = excluded.updated_at, contact_name = excluded.contact_name
  returning id, active_ticket_id into v_conv, v_active;
  insert into r values (v_conv = v_c05 and v_active = v_tk05, 'T06d upsert do webhook passa e mantém o foco',
    coalesce(v_active::text, '<null>'));

  -- T07 (service_role)
  for v_sql, v_tag in
    select * from (values
      (format('insert into public.ticket_status_history (ticket_id, to_status, actor_type) values (%L, ''novo'', ''system'')', v_tk05),
       'INSERT history'),
      ('update public.ticket_status_history set reason = ''x''', 'UPDATE history'),
      ('delete from public.ticket_status_history', 'DELETE history'),
      (format('insert into public.ticket_events (ticket_id, event_type, actor_type) values (%L, ''ticket.teste'', ''system'')', v_tk05),
       'INSERT events'),
      ('update public.ticket_events set metadata = ''{}''', 'UPDATE events'),
      ('delete from public.ticket_events', 'DELETE events')
    ) as x (s, t)
  loop
    perform pg_temp.expect_fail('T07a trilha sem escrita para service_role: ' || v_tag, v_sql, '42501');
  end loop;

  -- T08
  for v_sql, v_tag in
    select * from (values
      ('select public.require_ticket_actor(null, null)', 'require_ticket_actor'),
      ('select public.assert_ticket_refs(null, null, null, null)', 'assert_ticket_refs'),
      ('select public.ticket_current_contract(null)', 'ticket_current_contract'),
      ('select public.ticket_summary(null)', 'ticket_summary'),
      ('select public.ticket_record_event(null, null, null, null, null)', 'ticket_record_event'),
      ('select public.ticket_apply_transition(null, null, null, null, null, null)', 'ticket_apply_transition'),
      ('select public.ticket_apply_take_over(null, null)', 'ticket_apply_take_over')
    ) as x (s, t)
  loop
    perform pg_temp.expect_fail('T08 helper fechado para service_role: ' || v_tag, v_sql, '42501');
  end loop;

  reset role;  -- postgres: nem o dono reescreve a trilha nem fura o guard

  -- T07 (postgres)
  for v_sql, v_tag in
    select * from (values
      (format('update public.ticket_status_history set reason = ''x'' where ticket_id = %L', v_tk05), 'UPDATE history'),
      (format('delete from public.ticket_status_history where ticket_id = %L', v_tk05), 'DELETE history'),
      (format('update public.ticket_events set metadata = ''{}'' where ticket_id = %L', v_tk05), 'UPDATE events'),
      (format('delete from public.ticket_events where ticket_id = %L', v_tk05), 'DELETE events')
    ) as x (s, t)
  loop
    perform pg_temp.expect_fail('T07b trilha append-only até para o dono: ' || v_tag, v_sql, '0A000');
  end loop;

  -- T10
  perform pg_temp.expect_fail('T10a status fora da matriz, até para o dono',
    format('update public.tickets set status = ''resolvido'' where id = %L', v_tk05), 'P0001', 'INVALID_TRANSITION');
  perform pg_temp.expect_fail('T10b conversation_id imutável',
    format('update public.tickets set conversation_id = %L where id = %L', pg_temp.id('c11'), v_tk05),
    'P0001', 'TICKET_IMMUTABLE');
  perform pg_temp.expect_fail('T10c prazo +1 s fura a aritmética do SLA',
    format('update public.tickets set first_response_due_at = first_response_due_at + interval ''1 second'' where id = %L', v_tk05),
    '23514', 'tickets_first_response_due_check');
  perform pg_temp.expect_fail('T10d resolvido sem resolved_at',
    format('update public.tickets set status = ''resolvido'', sla_paused_at = now() where id = %L', v_tk10),
    '23514', 'tickets_resolved_at_check');

  set local role service_role;
end
$$;

reset role;

-- ============================================================================
-- Abertura e idempotência (T11–T18)
-- ============================================================================
set role service_role;

do $$
declare
  v_ana     uuid := pg_temp.id('ana');
  v_bia     uuid := pg_temp.id('bia');
  v_token   uuid := pg_temp.id('token');
  v_c11     uuid := pg_temp.id('c11');
  v_c14     uuid := pg_temp.id('c14');
  v_c15     uuid := pg_temp.id('c15');
  v_c16     uuid := pg_temp.id('c16');
  v_c17     uuid := pg_temp.id('c17');
  v_c18     uuid := pg_temp.id('c18');
  v_c19     uuid := pg_temp.id('c19');
  v_p11     uuid;
  v_tk11    uuid;
  v_id      uuid;
  v_id2     uuid;
  v_a       uuid;
  v_b       uuid;
  v_ma      uuid;
  v_m1      uuid;
  v_m25     uuid;
  v_m3      uuid;
  v_x1      uuid;
  v_x25     uuid;
  v_x3      uuid;
  v_xa      uuid;
  v_active  uuid;
  v_row     public.tickets%rowtype;
  v_pol     public.sla_policies%rowtype;
  v_sql     text;
  v_tag     text;
  v_res     text;
  v_t       text;
  v_n       integer;
  v_n2      integer;
  v_n3      integer;
  v_k       integer;
  v_k2      integer;
  v_k3      integer;
  j         jsonb;
  j2        jsonb;
begin
  -- T11: um ticket anterior em foco, depois o ticket do caso.
  j := public.create_ticket(p_conversation_id => v_c11, p_title => 'Ticket anterior', p_actor_user_id => v_ana);
  v_p11 := (j #>> '{ticket,id}')::uuid;
  j := public.create_ticket(p_conversation_id => v_c11, p_title => '  Sistema fora do ar  ', p_priority => 'media',
         p_actor_user_id => v_ana, p_idempotency_key => 'tk-idem-0001');
  v_tk11 := (j #>> '{ticket,id}')::uuid;
  insert into ids values ('tk11', v_tk11);

  select * into v_row from public.tickets t where t.id = v_tk11;
  select * into v_pol from public.sla_policies p where p.priority = 'media';
  insert into r values (
    (j ->> 'created')::boolean
    and v_row.number >= 1000 and v_row.status = 'novo' and v_row.title = 'Sistema fora do ar'
    and v_row.source = 'agent' and v_row.created_by_user_id = v_ana and v_row.created_by_token_id is null
    and v_row.created_at = now() and v_row.version = 1
    and v_row.sla_first_response_minutes = v_pol.first_response_minutes
    and v_row.sla_resolution_minutes = v_pol.resolution_minutes
    and v_row.sla_warn_pct = v_pol.warn_pct
    and v_row.first_response_due_at = now() + make_interval(mins => v_pol.first_response_minutes)
    and v_row.resolution_due_at = now() + make_interval(mins => v_pol.resolution_minutes),
    'T11a abertura: número, novo, prazos = abertura + minutos, snapshot e source=agent',
    format('#%s %s %s | 1ª +%s | solução +%s | v%s', v_row.number, v_row.status, v_row.source,
           v_row.first_response_due_at - v_row.created_at, v_row.resolution_due_at - v_row.created_at, v_row.version));
  insert into r values (v_row.customer_id = pg_temp.id('cu_sus') and v_row.contract_id = pg_temp.id('k_sus'),
    'T11b empresa e contrato vigente (suspenso conta) derivados do contato',
    coalesce(v_row.customer_id::text, '<null>') || ' | ' || coalesce(v_row.contract_id::text, '<null>'));

  select c.active_ticket_id into v_active from public.chat_conversations c where c.id = v_c11;
  select count(*) into v_n from public.ticket_events e
   where e.ticket_id = v_p11 and e.event_type = 'ticket.unfocused' and e.metadata ->> 'next' = v_tk11::text;
  select count(*) into v_n2 from public.ticket_events e
   where e.ticket_id = v_tk11 and e.event_type = 'ticket.focused' and e.metadata ->> 'previous' = v_p11::text;
  insert into r values (v_active = v_tk11 and v_n = 1 and v_n2 = 1, 'T11c foco movido para o ticket novo',
    format('foco=%s unfocused=%s focused=%s', v_active = v_tk11, v_n, v_n2));

  select string_agg(format('%s→%s:%s:%s', coalesce(h.from_status, 'null'), h.to_status, h.actor_type,
                           h.actor_user_id = v_ana), ',')
    into v_t
    from public.ticket_status_history h
   where h.ticket_id = v_tk11;
  select count(*) into v_n from public.ticket_events e
   where e.ticket_id = v_tk11 and e.event_type = 'ticket.created'
     and e.event_key = 'ticket.created:' || v_tk11::text
     and e.actor_type = 'agent' and e.actor_user_id = v_ana;
  insert into r values (v_t = 'null→novo:agent:t' and v_n = 1,
    'T11d history null→novo e ticket.created com event_key', coalesce(v_t, '<vazio>') || ' | ' || v_n);

  -- T12
  select (select count(*) from public.tickets), (select count(*) from public.ticket_status_history),
         (select count(*) from public.ticket_events)
    into v_n, v_n2, v_n3;
  j := public.create_ticket(p_conversation_id => v_c11, p_title => 'Reenvio', p_actor_user_id => v_ana,
         p_idempotency_key => 'tk-idem-0001');
  select (select count(*) from public.tickets), (select count(*) from public.ticket_status_history),
         (select count(*) from public.ticket_events)
    into v_k, v_k2, v_k3;
  insert into r values (
    (j #>> '{ticket,id}')::uuid = v_tk11 and not (j ->> 'created')::boolean and (v_n, v_n2, v_n3) = (v_k, v_k2, v_k3),
    'T12 mesma chave, ator e conversa devolve o mesmo ticket sem linha nova',
    format('created=%s | tickets %s→%s, history %s→%s, events %s→%s', j ->> 'created', v_n, v_k, v_n2, v_k2, v_n3, v_k3));

  -- T13
  j := public.create_ticket(p_conversation_id => v_c11, p_title => 'Mesma chave, outra analista',
         p_actor_user_id => v_bia, p_idempotency_key => 'tk-idem-0001', p_set_active => false);
  v_id := (j #>> '{ticket,id}')::uuid;
  j2 := public.create_ticket(p_conversation_id => v_c11, p_title => 'Mesma chave, integração',
          p_actor_token_id => v_token, p_idempotency_key => 'tk-idem-0001', p_set_active => false);
  v_id2 := (j2 #>> '{ticket,id}')::uuid;
  insert into r values (
    (j ->> 'created')::boolean and (j2 ->> 'created')::boolean
    and v_id <> v_tk11 and v_id2 <> v_tk11 and v_id <> v_id2,
    'T13a mesma chave com outro ator (usuário ou token) abre ticket novo',
    format('usuário=%s token=%s', j ->> 'created', j2 ->> 'created'));
  perform pg_temp.expect_fail('T13b mesmo ator e chave em outra conversa',
    format('select public.create_ticket(p_conversation_id => %L, p_title => ''Outra conversa'', '
           'p_actor_user_id => %L, p_idempotency_key => ''tk-idem-0001'')', pg_temp.id('c12'), v_ana),
    'P0001', 'IDEMPOTENCY_KEY_REUSED');

  -- T14
  perform pg_temp.expect_fail('T14a sem ator',
    format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'')', v_c14), 'P0001', 'INVALID_ACTOR');
  perform pg_temp.expect_fail('T14b dois atores',
    format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_user_id => %L, '
           'p_actor_token_id => %L)', v_c14, v_ana, v_token), 'P0001', 'INVALID_ACTOR');
  perform pg_temp.expect_fail('T14c usuário inativo',
    format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_user_id => %L)',
           v_c14, pg_temp.id('inactive')), 'P0001', 'FORBIDDEN');
  perform pg_temp.expect_fail('T14d token revogado',
    format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_token_id => %L)',
           v_c14, pg_temp.id('token_revoked')), 'P0001', 'FORBIDDEN');
  perform pg_temp.expect_fail('T14e token vencido',
    format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_token_id => %L)',
           v_c14, pg_temp.id('token_expired')), 'P0001', 'FORBIDDEN');
  perform pg_temp.expect_fail('T14f token não assume',
    format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_token_id => %L, '
           'p_take_over => true)', v_c14, v_token), 'P0001', 'FORBIDDEN');
  j := public.create_ticket(p_conversation_id => v_c14, p_title => 'Aberto pela IA', p_actor_token_id => v_token,
         p_source => 'ai', p_external_id => 'ia-conversa-14', p_ai_triage => '{"resumo":"teste"}');
  v_id := (j #>> '{ticket,id}')::uuid;
  select * into v_row from public.tickets t where t.id = v_id;
  select string_agg(format('%s:%s:%s', h.actor_type, h.actor_token_id = v_token, h.actor_user_id is null), ',')
    into v_t
    from public.ticket_status_history h
   where h.ticket_id = v_id;
  insert into r values (
    v_row.source = 'ai' and v_row.created_by_token_id = v_token and v_row.created_by_user_id is null
    and v_t = 'ai:t:t',
    'T14g token com p_source=ai: source=ai e history ai', v_row.source || ' | ' || coalesce(v_t, '<vazio>'));

  -- T15
  for v_sql, v_tag in
    select * from (values
      (format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_user_id => %L, '
              'p_product_id => %L)', v_c15, v_ana, pg_temp.id('q_arch')), 'PRODUCT_ARCHIVED'),
      (format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_user_id => %L, '
              'p_product_id => %L, p_category_id => %L)', v_c15, v_ana, pg_temp.id('q2'), pg_temp.id('cat_q1')),
       'CATEGORY_PRODUCT_MISMATCH'),
      (format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_user_id => %L, '
              'p_priority => ''x'')', v_c15, v_ana), 'INVALID_PRIORITY'),
      (format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_user_id => %L, '
              'p_assigned_to_user_id => %L)', v_c15, v_ana, pg_temp.id('inactive')), 'ASSIGNEE_INACTIVE'),
      (format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_user_id => %L, '
              'p_external_id => ''ext-15'')', v_c15, v_ana), 'INVALID_SOURCE'),
      (format('select public.create_ticket(p_conversation_id => %L, p_title => ''x'', p_actor_user_id => %L, '
              'p_status => ''resolvido'')', v_c15, v_ana), 'INVALID_INITIAL_STATUS')
    ) as x (s, t)
  loop
    perform pg_temp.expect_fail('T15 recusa na abertura: ' || v_tag, v_sql, 'P0001', v_tag);
  end loop;
  select count(*) into v_n from public.tickets t where t.conversation_id = v_c15;
  insert into r values (v_n = 0, 'T15 nenhuma recusa deixa ticket', v_n::text);

  -- T16: o ticket antigo foi aberto e cancelado há 2 h; mensagens soltas depois.
  j := public.create_ticket(p_conversation_id => v_c16, p_title => 'Assunto antigo', p_actor_user_id => v_ana);
  v_a := (j #>> '{ticket,id}')::uuid;
  v_ma := pg_temp.msg(v_c16, 'inbound', 'contact', 'delivered', now() - interval '90 minutes');
  perform public.ticket_transition(v_a, 'cancelado', 1, v_ana, null, 'Resolvido por outro canal');
  reset role;  -- postgres: o tempo passa
  perform pg_temp.shift_ticket(v_a, interval '2 hours');
  set local role service_role;
  v_m1 := pg_temp.msg(v_c16, 'inbound', 'contact', 'delivered', now() - interval '1 hour');
  v_m25 := pg_temp.msg(v_c16, 'inbound', 'contact', 'delivered', now() - interval '25 hours');
  v_m3 := pg_temp.msg(v_c16, 'inbound', 'contact', 'delivered', now() - interval '3 hours');
  j := public.create_ticket(p_conversation_id => v_c16, p_title => 'Assunto novo', p_actor_user_id => v_ana);
  v_b := (j #>> '{ticket,id}')::uuid;
  select m.ticket_id into v_x1 from public.chat_messages m where m.id = v_m1;
  select m.ticket_id into v_x25 from public.chat_messages m where m.id = v_m25;
  select m.ticket_id into v_x3 from public.chat_messages m where m.id = v_m3;
  select m.ticket_id into v_xa from public.chat_messages m where m.id = v_ma;
  insert into r values ((j ->> 'linked_messages')::integer = 1 and v_x1 = v_b, 'T16a solta de 1 h entra no ticket novo',
    format('linked=%s', j ->> 'linked_messages'));
  insert into r values (v_x25 is null, 'T16b solta de 25 h fica de fora', coalesce(v_x25::text, '<null>'));
  insert into r values (v_x3 is null, 'T16c solta anterior ao closed_at do último ticket fica de fora',
    coalesce(v_x3::text, '<null>'));
  insert into r values (v_xa = v_a, 'T16d já carimbada não muda de ticket', coalesce(v_xa::text, '<null>'));
  select count(*) into v_n from public.ticket_events e
   where e.ticket_id = v_b and e.event_type = 'ticket.messages_linked'
     and (e.metadata ->> 'count')::integer = 1
     and (e.metadata ->> 'since')::timestamptz = now() - interval '2 hours';
  insert into r values (v_n = 1, 'T16e evento messages_linked com count e since', v_n::text);

  -- T17
  perform pg_temp.msg(v_c17, 'outbound', 'agent', 'sent', now() - interval '10 minutes');
  j := public.create_ticket(p_conversation_id => v_c17, p_title => 'Já respondido', p_actor_user_id => v_ana);
  select * into v_row from public.tickets t where t.id = (j #>> '{ticket,id}')::uuid;
  insert into r values ((j ->> 'linked_messages')::integer = 1 and v_row.first_responded_at = v_row.created_at,
    'T17a resposta humana já sent e vinculada conta na abertura',
    format('linked=%s | 1ª resposta %s', j ->> 'linked_messages', coalesce(v_row.first_responded_at::text, '<null>')));
  perform pg_temp.msg(v_c18, 'outbound', 'agent', 'sent', now() - interval '10 minutes', 'note');
  perform pg_temp.msg(v_c18, 'outbound', 'agent', 'failed', now() - interval '5 minutes');
  j := public.create_ticket(p_conversation_id => v_c18, p_title => 'Só nota e falha', p_actor_user_id => v_ana);
  select * into v_row from public.tickets t where t.id = (j #>> '{ticket,id}')::uuid;
  insert into r values ((j ->> 'linked_messages')::integer = 2 and v_row.first_responded_at is null,
    'T17b nota e failed vinculadas não contam',
    format('linked=%s | 1ª resposta %s', j ->> 'linked_messages', coalesce(v_row.first_responded_at::text, '<null>')));

  -- T18
  j := public.create_ticket(p_conversation_id => v_c19, p_title => 'Assumir na abertura', p_actor_user_id => v_ana,
         p_take_over => true);
  v_id := (j #>> '{ticket,id}')::uuid;
  select * into v_row from public.tickets t where t.id = v_id;
  select c.status, c.active_ticket_id into v_t, v_active from public.chat_conversations c where c.id = v_c19;
  select string_agg(coalesce(h.from_status, 'null') || '→' || h.to_status, ',' order by coalesce(h.from_status, ''))
    into v_res
    from public.ticket_status_history h
   where h.ticket_id = v_id;
  insert into r values (
    (j ->> 'conversation_changed')::boolean and v_t = 'human' and v_active = v_id
    and v_row.assigned_to_user_id = v_ana and v_row.status = 'em_atendimento'
    and v_res = 'null→novo,novo→em_atendimento',
    'T18 p_take_over: conversa human, responsável = ator, em_atendimento, 2 linhas de history',
    format('changed=%s conversa=%s status=%s history=%s', j ->> 'conversation_changed', v_t, v_row.status, v_res));

  -- T18b: tudo acima tem o MESMO occurred_at (uma transação). A ordem da trilha,
  -- history e events juntos, vem de seq; o id é aleatório e não serve.
  select string_agg(x.item, ',' order by x.occurred_at, x.seq)
    into v_res
    from (
      select h.occurred_at, h.seq, coalesce(h.from_status, 'null') || '→' || h.to_status as item
        from public.ticket_status_history h where h.ticket_id = v_id
      union all
      select e.occurred_at, e.seq, e.event_type
        from public.ticket_events e where e.ticket_id = v_id
    ) x;
  insert into r values (
    v_res = 'null→novo,ticket.created,ticket.focused,ticket.assigned,novo→em_atendimento',
    'T18b trilha na ordem em que a abertura com "Assumir" gravou', coalesce(v_res, '<vazio>'));
end
$$;

reset role;

-- ============================================================================
-- Carimbo, foco e 1ª resposta (T20–T22, T30–T33)
-- ============================================================================
set role service_role;

do $$
declare
  v_ana   uuid := pg_temp.id('ana');
  v_tk05  uuid := pg_temp.id('tk05');
  v_c20   uuid := pg_temp.id('c20');
  v_c21   uuid := pg_temp.id('c21');
  v_c22   uuid := pg_temp.id('c22');
  v_c30   uuid := pg_temp.id('c30');
  v_c31   uuid := pg_temp.id('c31');
  v_tk20  uuid;
  v_tk30  uuid;
  v_tk31  uuid;
  v_p     uuid;
  v_q     uuid;
  v_rr    uuid;
  v_m     uuid;
  v_m1    uuid;
  v_m2    uuid;
  v_x     uuid;
  v_active uuid;
  v_ts    timestamptz;
  v_ts2   timestamptz;
  v_ver   integer;
  v_n     integer;
  v_n2    integer;
  v_ok    boolean;
  j       jsonb;
begin
  -- T20
  j := public.create_ticket(p_conversation_id => v_c20, p_title => 'Foco da conversa 20', p_actor_user_id => v_ana);
  v_tk20 := (j #>> '{ticket,id}')::uuid;
  insert into ids values ('tk20', v_tk20);
  v_m := pg_temp.msg(v_c20, 'inbound', 'contact', 'delivered', now(), 'text', v_tk05);
  select m.ticket_id into v_x from public.chat_messages m where m.id = v_m;
  insert into r values (v_x = v_tk20, 'T20a inbound herda o foco, ignorando o ticket_id informado',
    coalesce(v_x::text, '<null>'));
  v_m2 := pg_temp.msg(v_c21, 'inbound', 'contact', 'delivered', now(), 'text', v_tk20);
  select m.ticket_id into v_x from public.chat_messages m where m.id = v_m2;
  insert into r values (v_x is null, 'T20b sem foco a mensagem fica solta', coalesce(v_x::text, '<null>'));

  -- T21
  reset role;  -- postgres: nem o dono põe ticket de outra conversa na mensagem ou no foco
  perform pg_temp.expect_fail('T21a mensagem com ticket de outra conversa',
    format('update public.chat_messages set ticket_id = %L where id = %L', v_tk05, v_m), '23503', 'chat_messages_ticket_fkey');
  perform pg_temp.expect_fail('T21b foco com ticket de outra conversa',
    format('update public.chat_conversations set active_ticket_id = %L where id = %L', v_tk05, v_c20),
    '23503', 'chat_conversations_active_ticket_fkey');
  set local role service_role;

  -- T22
  j := public.create_ticket(p_conversation_id => v_c22, p_title => 'P', p_actor_user_id => v_ana);
  v_p := (j #>> '{ticket,id}')::uuid;
  j := public.create_ticket(p_conversation_id => v_c22, p_title => 'Q', p_actor_user_id => v_ana, p_set_active => false);
  v_q := (j #>> '{ticket,id}')::uuid;
  j := public.create_ticket(p_conversation_id => v_c22, p_title => 'R', p_actor_user_id => v_ana, p_set_active => false);
  v_rr := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_rr, 'cancelado', 1, v_ana, null, 'Aberto por engano');

  j := public.ticket_set_active(v_c22, v_q, v_ana);
  select c.active_ticket_id into v_active from public.chat_conversations c where c.id = v_c22;
  select count(*) into v_n from public.ticket_events e
   where e.ticket_id = v_p and e.event_type = 'ticket.unfocused' and e.metadata ->> 'next' = v_q::text
     and e.actor_type = 'agent' and e.actor_user_id = v_ana;
  select count(*) into v_n2 from public.ticket_events e
   where e.ticket_id = v_q and e.event_type = 'ticket.focused' and e.metadata ->> 'previous' = v_p::text
     and e.actor_type = 'agent' and e.actor_user_id = v_ana;
  insert into r values ((j ->> 'changed')::boolean and v_active = v_q and v_n = 1 and v_n2 = 1,
    'T22a set_active troca o foco e grava unfocused/focused', format('%s | unfocused=%s focused=%s', j, v_n, v_n2));
  perform pg_temp.expect_fail('T22b set_active com ticket de outra conversa',
    format('select public.ticket_set_active(%L, %L, %L)', v_c22, v_tk05, v_ana), 'P0001', 'TICKET_NOT_IN_CONVERSATION');
  perform pg_temp.expect_fail('T22c set_active com ticket terminal',
    format('select public.ticket_set_active(%L, %L, %L)', v_c22, v_rr, v_ana), 'P0001', 'TICKET_TERMINAL');
  j := public.ticket_set_active(v_c22, null, v_ana);
  select c.active_ticket_id into v_active from public.chat_conversations c where c.id = v_c22;
  insert into r values ((j ->> 'changed')::boolean and v_active is null, 'T22d set_active null limpa o foco', j::text);
  j := public.ticket_set_active(v_c22, null, v_ana);
  insert into r values (not (j ->> 'changed')::boolean, 'T22e repetir é changed=false', j::text);

  -- T30–T33: ticket aberto há 1 h, em foco na conversa 30.
  j := public.create_ticket(p_conversation_id => v_c30, p_title => 'Primeira resposta', p_actor_user_id => v_ana);
  v_tk30 := (j #>> '{ticket,id}')::uuid;
  insert into ids values ('tk30', v_tk30);
  reset role;  -- postgres: o tempo passa
  perform pg_temp.shift_ticket(v_tk30, interval '1 hour');
  set local role service_role;
  v_ver := pg_temp.ver(v_tk30);

  -- T30
  perform pg_temp.msg(v_c30, 'outbound', 'agent', 'sent', now() - interval '50 minutes', 'note');
  select t.first_responded_at into v_ts from public.tickets t where t.id = v_tk30;
  insert into r values (v_ts is null, 'T30 nota do analista não é 1ª resposta', coalesce(v_ts::text, '<null>'));

  -- T32
  perform pg_temp.msg(v_c30, 'outbound', 'device', 'sent', now() - interval '45 minutes');
  perform pg_temp.msg(v_c30, 'inbound', 'contact', 'delivered', now() - interval '44 minutes');
  select t.first_responded_at, t.first_ai_response_at into v_ts, v_ts2 from public.tickets t where t.id = v_tk30;
  insert into r values (v_ts is null and v_ts2 is null, 'T32a device e contact não contam',
    coalesce(v_ts::text, '<null>') || ' | ' || coalesce(v_ts2::text, '<null>'));
  perform pg_temp.msg(v_c30, 'outbound', 'ai', 'sent', now() - interval '40 minutes');
  select t.first_responded_at, t.first_ai_response_at into v_ts, v_ts2 from public.tickets t where t.id = v_tk30;
  insert into r values (v_ts is null and v_ts2 = now() - interval '40 minutes',
    'T32b IA enviada carimba só first_ai_response_at',
    coalesce(v_ts::text, '<null>') || ' | ' || coalesce(v_ts2::text, '<null>'));

  -- T31
  v_m1 := pg_temp.msg(v_c30, 'outbound', 'agent', 'pending', now() - interval '35 minutes');
  select t.first_responded_at into v_ts from public.tickets t where t.id = v_tk30;
  insert into r values (v_ts is null, 'T31a pending não conta', coalesce(v_ts::text, '<null>'));
  update public.chat_messages set delivery_status = 'failed' where id = v_m1;
  perform pg_temp.msg(v_c30, 'outbound', 'agent', 'failed', now() - interval '34 minutes');
  select t.first_responded_at into v_ts from public.tickets t where t.id = v_tk30;
  insert into r values (v_ts is null, 'T31b failed não conta (no UPDATE e no INSERT)', coalesce(v_ts::text, '<null>'));
  v_m2 := pg_temp.msg(v_c30, 'outbound', 'agent', 'pending', now() - interval '30 minutes');
  update public.chat_messages set delivery_status = 'sent' where id = v_m2;
  select t.first_responded_at into v_ts from public.tickets t where t.id = v_tk30;
  -- Conta o ACEITE (o UPDATE para sent), não o created_at: no envio normal a
  -- diferença é a latência do provedor; no reenvio, é o atraso inteiro (T31e).
  insert into r values (v_ts = now(), 'T31c pending→sent conta no instante do aceite',
    coalesce(v_ts::text, '<null>'));
  update public.chat_messages set delivery_status = 'delivered' where id = v_m2;
  perform pg_temp.msg(v_c30, 'outbound', 'agent', 'sent', now() - interval '20 minutes');
  select t.first_responded_at into v_ts from public.tickets t where t.id = v_tk30;
  insert into r values (v_ts = now(), 'T31d delivered e resposta seguinte não mudam nada',
    coalesce(v_ts::text, '<null>'));

  -- T31e: aberto há 6 h (prazo da 1ª resposta: 4 h). As respostas do analista e
  -- da IA saíram 10 min depois da abertura, falharam, e o reenvio (send/route.ts
  -- reaproveita a linha, com o created_at da tentativa) só foi aceito agora.
  j := public.create_ticket(p_conversation_id => v_c31, p_title => 'Reenvio atrasado', p_actor_user_id => v_ana);
  v_tk31 := (j #>> '{ticket,id}')::uuid;
  reset role;
  perform pg_temp.shift_ticket(v_tk31, interval '6 hours');
  set local role service_role;
  v_m := pg_temp.msg(v_c31, 'outbound', 'agent', 'pending', now() - interval '350 minutes');
  v_x := pg_temp.msg(v_c31, 'outbound', 'ai', 'pending', now() - interval '350 minutes');
  update public.chat_messages set delivery_status = 'failed' where id in (v_m, v_x);
  update public.chat_messages set delivery_status = 'pending' where id in (v_m, v_x);
  update public.chat_messages set delivery_status = 'sent' where id in (v_m, v_x);
  select t.first_responded_at, t.first_ai_response_at, t.first_responded_at > t.first_response_due_at
    into v_ts, v_ts2, v_ok
    from public.tickets t where t.id = v_tk31;
  insert into r values (v_ts = now() and v_ts2 = now() and v_ok,
    'T31e reenvio de failed conta no aceite (analista e IA) e fica fora do prazo',
    format('%s | %s | fora do prazo=%s', v_ts, v_ts2, v_ok));

  -- T33
  insert into r values (pg_temp.ver(v_tk30) = v_ver, 'T33 carimbo da 1ª resposta não muda version',
    v_ver || ' → ' || pg_temp.ver(v_tk30));
end
$$;

reset role;

-- ============================================================================
-- Transição e SLA (T40–T48)
-- ============================================================================
set role service_role;

do $$
declare
  v_ana    uuid := pg_temp.id('ana');
  v_bia    uuid := pg_temp.id('bia');
  v_tk40   uuid;
  v_tk41   uuid;
  v_tk43   uuid;
  v_tk44   uuid;
  v_tk45   uuid;
  v_tk46   uuid;
  v_x      uuid;
  v_active uuid;
  v_row    public.tickets%rowtype;
  v_before public.tickets%rowtype;
  v_d      text;
  v_h      text;
  v_t      text;
  v_n      integer;
  j        jsonb;
begin
  -- T40
  j := public.create_ticket(p_conversation_id => pg_temp.id('c40'), p_title => 'Transições', p_actor_user_id => v_ana);
  v_tk40 := (j #>> '{ticket,id}')::uuid;
  j := public.ticket_transition(v_tk40, 'em_triagem', 1, v_ana);
  select count(*) into v_n from public.ticket_status_history h
   where h.ticket_id = v_tk40 and h.from_status = 'novo' and h.to_status = 'em_triagem'
     and h.actor_type = 'agent' and h.actor_user_id = v_ana and h.actor_token_id is null;
  insert into r values (
    (j ->> 'changed')::boolean and (j #>> '{ticket,version}')::integer = 2 and j ->> 'from' = 'novo' and v_n = 1,
    'T40a transição válida: version+1 e history com ator', format('%s | history=%s', j - 'ticket', v_n));
  j := public.ticket_transition(v_tk40, 'em_triagem', 1, v_ana);
  insert into r values (not (j ->> 'changed')::boolean and (j #>> '{ticket,version}')::integer = 2,
    'T40b destino igual é changed=false mesmo com versão velha', (j - 'ticket')::text);

  -- T41
  j := public.create_ticket(p_conversation_id => pg_temp.id('c41'), p_title => 'Pula etapas', p_actor_user_id => v_ana);
  v_tk41 := (j #>> '{ticket,id}')::uuid;
  begin
    perform public.ticket_transition(v_tk41, 'resolvido', 1, v_ana);
    insert into r values (false, 'T41 novo→resolvido: INVALID_TRANSITION, destinos em ordem e status atual', 'passou');
  exception when others then
    get stacked diagnostics v_d = pg_exception_detail, v_h = pg_exception_hint;
    insert into r values (
      sqlstate = 'P0001' and sqlerrm = 'INVALID_TRANSITION'
      and v_d = '["em_triagem", "em_atendimento", "aguardando_cliente", "aguardando_interno", "cancelado"]'
      and v_h = 'novo',
      'T41 novo→resolvido: INVALID_TRANSITION, destinos em ordem e status atual',
      sqlerrm || ' | ' || coalesce(v_d, '<null>') || ' | ' || coalesce(v_h, '<null>'));
  end;

  -- T42
  begin
    perform public.ticket_transition(v_tk40, 'em_atendimento', 1, v_ana);
    insert into r values (false, 'T42a versão velha → VERSION_CONFLICT com a atual', 'passou');
  exception when others then
    get stacked diagnostics v_d = pg_exception_detail;
    insert into r values (sqlerrm = 'VERSION_CONFLICT' and v_d = '2', 'T42a versão velha → VERSION_CONFLICT com a atual',
      sqlerrm || ' | ' || coalesce(v_d, '<null>'));
  end;
  begin
    perform public.ticket_transition(v_tk40, 'em_atendimento', null, v_ana);
    insert into r values (false, 'T42b versão nula → VERSION_CONFLICT com a atual', 'passou');
  exception when others then
    get stacked diagnostics v_d = pg_exception_detail;
    insert into r values (sqlerrm = 'VERSION_CONFLICT' and v_d = '2', 'T42b versão nula → VERSION_CONFLICT com a atual',
      sqlerrm || ' | ' || coalesce(v_d, '<null>'));
  end;

  -- T43: aberto há 3 h, pausado há 2 h, retomado agora.
  j := public.create_ticket(p_conversation_id => pg_temp.id('c43'), p_title => 'Pausa', p_actor_user_id => v_ana);
  v_tk43 := (j #>> '{ticket,id}')::uuid;
  insert into ids values ('tk43', v_tk43);
  reset role;  -- postgres: o tempo passa
  perform pg_temp.shift_ticket(v_tk43, interval '3 hours');
  set local role service_role;
  perform public.ticket_transition(v_tk43, 'aguardando_cliente', 1, v_ana);
  reset role;
  update public.tickets set sla_paused_at = now() - interval '2 hours' where id = v_tk43;
  set local role service_role;
  select * into v_before from public.tickets t where t.id = v_tk43;
  perform public.ticket_transition(v_tk43, 'em_atendimento', v_before.version, v_ana);
  select * into v_row from public.tickets t where t.id = v_tk43;
  insert into r values (
    v_row.sla_paused_seconds = 7200 and v_row.sla_paused_at is null
    and v_row.resolution_due_at = v_before.resolution_due_at + interval '2 hours'
    and v_row.first_response_due_at = v_before.first_response_due_at,
    'T43 pausa de 2 h: +7200 s só na solução', format('pausa=%s s | solução %s | 1ª %s', v_row.sla_paused_seconds,
      v_row.resolution_due_at - v_before.resolution_due_at, v_row.first_response_due_at - v_before.first_response_due_at));

  -- T44: aberto há 4 h, resolvido há 3 h, reaberto agora.
  j := public.create_ticket(p_conversation_id => pg_temp.id('c44'), p_title => 'Reabertura', p_actor_user_id => v_ana);
  v_tk44 := (j #>> '{ticket,id}')::uuid;
  reset role;
  perform pg_temp.shift_ticket(v_tk44, interval '4 hours');
  set local role service_role;
  perform public.ticket_transition(v_tk44, 'em_atendimento', pg_temp.ver(v_tk44), v_ana);
  perform public.ticket_transition(v_tk44, 'resolvido', pg_temp.ver(v_tk44), v_ana);
  reset role;
  update public.tickets set resolved_at = now() - interval '3 hours', sla_paused_at = now() - interval '3 hours'
   where id = v_tk44;
  set local role service_role;
  select * into v_before from public.tickets t where t.id = v_tk44;
  perform public.ticket_transition(v_tk44, 'em_atendimento', v_before.version, v_ana);
  select * into v_row from public.tickets t where t.id = v_tk44;
  insert into r values (
    v_row.reopened_count = 1 and v_row.resolved_at is null and v_row.sla_paused_at is null
    and v_row.sla_paused_seconds = 10800
    and v_row.resolution_due_at = v_before.resolution_due_at + interval '3 hours'
    and v_row.first_response_due_at = v_before.first_response_due_at,
    'T44 resolver, 3 h parado, reabrir: reopened_count=1, resolved_at nulo, solução +3 h',
    format('reaberto=%s resolved_at=%s pausa=%s s', v_row.reopened_count, coalesce(v_row.resolved_at::text, '<null>'),
      v_row.sla_paused_seconds));

  -- T45: pausado há 1 h, resolvido agora.
  j := public.create_ticket(p_conversation_id => pg_temp.id('c45'), p_title => 'Pausa até resolver', p_actor_user_id => v_ana);
  v_tk45 := (j #>> '{ticket,id}')::uuid;
  reset role;
  perform pg_temp.shift_ticket(v_tk45, interval '2 hours');
  set local role service_role;
  perform public.ticket_transition(v_tk45, 'aguardando_cliente', 1, v_ana);
  reset role;
  update public.tickets set sla_paused_at = now() - interval '1 hour' where id = v_tk45;
  set local role service_role;
  perform public.ticket_transition(v_tk45, 'resolvido', pg_temp.ver(v_tk45), v_ana);
  select * into v_row from public.tickets t where t.id = v_tk45;
  insert into r values (
    v_row.status = 'resolvido' and v_row.sla_paused_at = now() - interval '1 hour'
    and v_row.resolved_at = now() and v_row.sla_paused_seconds = 0,
    'T45 aguardando_cliente→resolvido mantém o início da pausa',
    format('%s | pausa desde %s | resolvido em %s', v_row.status, v_row.sla_paused_at, v_row.resolved_at));

  -- T46
  j := public.create_ticket(p_conversation_id => pg_temp.id('c46'), p_title => 'Cancelar', p_actor_user_id => v_ana);
  v_tk46 := (j #>> '{ticket,id}')::uuid;
  perform pg_temp.expect_fail('T46a cancelar sem motivo',
    format('select public.ticket_transition(%L, ''cancelado'', 1, %L)', v_tk46, v_ana), 'P0001', 'REASON_REQUIRED');
  perform pg_temp.expect_fail('T46b cancelar com motivo em branco',
    format('select public.ticket_transition(%L, ''cancelado'', 1, %L, null, ''   '')', v_tk46, v_ana),
    'P0001', 'REASON_REQUIRED');
  perform public.ticket_transition(v_tk46, 'cancelado', 1, v_ana, null, '  Cliente desistiu  ');
  select * into v_row from public.tickets t where t.id = v_tk46;
  select h.reason into v_t from public.ticket_status_history h
   where h.ticket_id = v_tk46 and h.to_status = 'cancelado';
  select c.active_ticket_id into v_active from public.chat_conversations c where c.id = pg_temp.id('c46');
  select count(*) into v_n from public.ticket_events e
   where e.ticket_id = v_tk46 and e.event_type = 'ticket.unfocused' and e.metadata ->> 'reason' = 'terminal';
  insert into r values (
    v_row.status = 'cancelado' and v_row.closed_at = now() and v_t = 'Cliente desistiu'
    and v_active is null and v_n = 1,
    'T46c cancelar com motivo: closed_at, motivo e saída do foco',
    format('%s | motivo=%s | foco=%s | unfocused=%s', v_row.status, v_t, coalesce(v_active::text, '<null>'), v_n));
  v_x := pg_temp.msg(pg_temp.id('c46'), 'inbound', 'contact', 'delivered');
  select m.ticket_id into v_x from public.chat_messages m where m.id = v_x;
  insert into r values (v_x is null, 'T46d o inbound seguinte fica solto', coalesce(v_x::text, '<null>'));

  -- T47: o ticket do T44 resolve e fecha.
  perform public.ticket_transition(v_tk44, 'resolvido', pg_temp.ver(v_tk44), v_ana);
  perform public.ticket_transition(v_tk44, 'fechado', pg_temp.ver(v_tk44), v_ana);
  begin
    perform public.ticket_transition(v_tk44, 'em_atendimento', pg_temp.ver(v_tk44), v_ana);
    insert into r values (false, 'T47 sair de fechado: INVALID_TRANSITION com []', 'passou');
  exception when others then
    get stacked diagnostics v_d = pg_exception_detail, v_h = pg_exception_hint;
    insert into r values (sqlerrm = 'INVALID_TRANSITION' and v_d = '[]' and v_h = 'fechado',
      'T47 sair de fechado: INVALID_TRANSITION com []',
      sqlerrm || ' | ' || coalesce(v_d, '<null>') || ' | ' || coalesce(v_h, '<null>'));
  end;

  -- T48
  perform pg_temp.expect_fail('T48a ticket_update em terminal',
    format('select public.ticket_update(%L, %s, ''{"title":"Novo título"}'', %L)', v_tk44, pg_temp.ver(v_tk44), v_ana),
    'P0001', 'TICKET_TERMINAL');
  perform pg_temp.expect_fail('T48b ticket_assign em terminal',
    format('select public.ticket_assign(%L, %s, %L, %L)', v_tk44, pg_temp.ver(v_tk44), v_bia, v_ana),
    'P0001', 'TICKET_TERMINAL');
end
$$;

reset role;

-- ============================================================================
-- Edição, atribuição e "Assumir" (T50–T63)
-- ============================================================================
set role service_role;

do $$
declare
  v_ana    uuid := pg_temp.id('ana');
  v_bia    uuid := pg_temp.id('bia');
  v_tk11   uuid := pg_temp.id('tk11');
  v_tk30   uuid := pg_temp.id('tk30');
  v_tk43   uuid := pg_temp.id('tk43');
  v_c63    uuid := pg_temp.id('c63');
  v_id     uuid;
  v_a      uuid;
  v_b      uuid;
  v_c      uuid;
  v_d      uuid;
  v_active uuid;
  v_row    public.tickets%rowtype;
  v_before public.tickets%rowtype;
  v_pol    public.sla_policies%rowtype;
  v_det    text;
  v_t      text;
  v_n      integer;
  j        jsonb;
begin
  select * into v_pol from public.sla_policies p where p.priority = 'alta';

  -- T50: o ticket do T43 (7200 s parados, sem 1ª resposta).
  select * into v_before from public.tickets t where t.id = v_tk43;
  j := public.ticket_update(v_tk43, v_before.version, '{"priority":"alta"}', v_ana);
  select * into v_row from public.tickets t where t.id = v_tk43;
  select count(*) into v_n from public.ticket_events e
   where e.ticket_id = v_tk43 and e.event_type = 'ticket.updated'
     and e.metadata -> 'changes' -> 'priority' = '{"from":"media","to":"alta"}'::jsonb;
  insert into r values (
    (j ->> 'changed')::boolean and v_before.first_responded_at is null and v_before.sla_paused_seconds = 7200
    and v_row.version = v_before.version + 1 and v_row.priority = 'alta'
    and v_row.sla_first_response_minutes = v_pol.first_response_minutes
    and v_row.sla_resolution_minutes = v_pol.resolution_minutes
    and v_row.sla_warn_pct = v_pol.warn_pct
    and v_row.first_response_due_at = v_row.created_at + make_interval(mins => v_pol.first_response_minutes)
    and v_row.resolution_due_at = v_row.created_at + make_interval(mins => v_pol.resolution_minutes)
                                  + interval '7200 seconds'
    and v_n = 1,
    'T50 media→alta sem 1ª resposta: snapshot novo, os dois prazos recalculados (pausa somada)',
    format('1ª +%s | solução +%s | evento=%s', v_row.first_response_due_at - v_row.created_at,
      v_row.resolution_due_at - v_row.created_at, v_n));

  -- T51: o ticket do T30 (1ª resposta já carimbada).
  select * into v_before from public.tickets t where t.id = v_tk30;
  perform public.ticket_update(v_tk30, v_before.version, '{"priority":"alta"}', v_ana);
  select * into v_row from public.tickets t where t.id = v_tk30;
  insert into r values (
    v_before.first_responded_at is not null and v_row.priority = 'alta'
    and v_row.first_responded_at = v_before.first_responded_at
    and v_row.first_response_due_at = v_before.first_response_due_at
    and v_row.sla_first_response_minutes = v_before.sla_first_response_minutes
    and v_row.sla_resolution_minutes = v_pol.resolution_minutes
    and v_row.resolution_due_at = v_row.created_at + make_interval(mins => v_pol.resolution_minutes),
    'T51 media→alta depois da 1ª resposta: 1ª resposta intacta',
    format('1ª %s→%s (%s→%s min)', v_before.first_response_due_at, v_row.first_response_due_at,
      v_before.sla_first_response_minutes, v_row.sla_first_response_minutes));

  -- T52
  perform public.ticket_update(v_tk11, pg_temp.ver(v_tk11), jsonb_build_object('customer_id', pg_temp.id('cu_act')), v_ana);
  select * into v_row from public.tickets t where t.id = v_tk11;
  insert into r values (v_row.customer_id = pg_temp.id('cu_act') and v_row.contract_id = pg_temp.id('k_act'),
    'T52a empresa trocada → contrato vigente da nova',
    coalesce(v_row.customer_id::text, '<null>') || ' | ' || coalesce(v_row.contract_id::text, '<null>'));
  perform pg_temp.expect_fail('T52b empresa arquivada',
    format('select public.ticket_update(%L, %s, %L, %L)', v_tk11, pg_temp.ver(v_tk11),
           jsonb_build_object('customer_id', pg_temp.id('cu_arch')), v_ana),
    'P0001', 'CUSTOMER_ARCHIVED');

  -- T53
  perform pg_temp.expect_fail('T53a chave desconhecida no patch',
    format('select public.ticket_update(%L, %s, ''{"status":"fechado"}'', %L)', v_tk11, pg_temp.ver(v_tk11), v_ana),
    'P0001', 'INVALID_PATCH');
  perform pg_temp.expect_fail('T53b patch vazio',
    format('select public.ticket_update(%L, %s, ''{}'', %L)', v_tk11, pg_temp.ver(v_tk11), v_ana),
    'P0001', 'INVALID_PATCH');
  j := public.ticket_update(v_tk11, 0, jsonb_build_object('title', v_row.title), v_ana);
  insert into r values (not (j ->> 'changed')::boolean and pg_temp.ver(v_tk11) = v_row.version,
    'T53c patch sem mudança é changed=false (antes da versão)', (j - 'ticket')::text);

  -- T60
  j := public.create_ticket(p_conversation_id => pg_temp.id('c60'), p_title => 'Atribuição', p_actor_user_id => v_ana);
  v_id := (j #>> '{ticket,id}')::uuid;
  perform pg_temp.expect_fail('T60a atribuir a inativo',
    format('select public.ticket_assign(%L, 1, %L, %L)', v_id, pg_temp.id('inactive'), v_ana), 'P0001', 'ASSIGNEE_INACTIVE');
  j := public.ticket_assign(v_id, 1, v_bia, v_ana);
  select * into v_row from public.tickets t where t.id = v_id;
  select count(*) into v_n from public.ticket_events e
   where e.ticket_id = v_id and e.event_type = 'ticket.assigned'
     and e.metadata = jsonb_build_object('from', null, 'to', v_bia)
     and e.actor_type = 'agent' and e.actor_user_id = v_ana;
  insert into r values ((j ->> 'changed')::boolean and v_row.version = 2 and v_row.assigned_to_user_id = v_bia and v_n = 1,
    'T60b atribuir: version+1 e evento', format('v%s | evento=%s', v_row.version, v_n));

  -- T61: conversa em bot, ticket fora do foco.
  j := public.create_ticket(p_conversation_id => pg_temp.id('c61'), p_title => 'Assumir pelo ticket',
         p_actor_user_id => v_bia, p_set_active => false);
  v_id := (j #>> '{ticket,id}')::uuid;
  j := public.ticket_take_over(v_id, v_ana);
  select * into v_row from public.tickets t where t.id = v_id;
  select c.status, c.active_ticket_id into v_t, v_active from public.chat_conversations c where c.id = pg_temp.id('c61');
  insert into r values (
    (j ->> 'conversation_changed')::boolean and v_t = 'human' and v_active = v_id
    and v_row.assigned_to_user_id = v_ana and v_row.status = 'em_atendimento',
    'T61 take_over em novo: conversa human, foco, responsável = ator, em_atendimento',
    format('conversa=%s foco=%s status=%s', v_t, v_active = v_id, v_row.status));

  -- T62
  j := public.create_ticket(p_conversation_id => pg_temp.id('c62'), p_title => 'De outra analista',
         p_actor_user_id => v_bia, p_assigned_to_user_id => v_bia);
  v_id := (j #>> '{ticket,id}')::uuid;
  begin
    perform public.ticket_take_over(v_id, v_ana);
    insert into r values (false, 'T62a ticket de outra: ALREADY_ASSIGNED com o id no DETAIL', 'passou');
  exception when others then
    get stacked diagnostics v_det = pg_exception_detail;
    insert into r values (sqlerrm = 'ALREADY_ASSIGNED' and v_det = v_bia::text,
      'T62a ticket de outra: ALREADY_ASSIGNED com o id no DETAIL', sqlerrm || ' | ' || coalesce(v_det, '<null>'));
  end;
  perform public.ticket_take_over(v_id, v_ana, true);
  select * into v_row from public.tickets t where t.id = v_id;
  select count(*) into v_n from public.ticket_events e
   where e.ticket_id = v_id and e.event_type = 'ticket.assigned'
     and e.metadata = jsonb_build_object('from', v_bia, 'to', v_ana, 'via', 'take_over');
  insert into r values (v_row.assigned_to_user_id = v_ana and v_row.status = 'em_atendimento' and v_n = 1,
    'T62b com p_reassign assume', format('%s | evento=%s', v_row.status, v_n));

  -- T63
  j := public.create_ticket(p_conversation_id => v_c63, p_title => 'Resolvido', p_actor_user_id => v_ana,
         p_take_over => true);
  v_a := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_a, 'resolvido', pg_temp.ver(v_a), v_ana);
  perform public.ticket_take_over(v_a, v_ana);
  j := public.create_ticket(p_conversation_id => v_c63, p_title => 'Aguardando cliente', p_actor_user_id => v_ana,
         p_set_active => false);
  v_b := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_b, 'aguardando_cliente', 1, v_ana);
  perform public.ticket_take_over(v_b, v_ana);
  j := public.create_ticket(p_conversation_id => v_c63, p_title => 'Aguardando interno', p_actor_user_id => v_ana,
         p_set_active => false);
  v_c := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_c, 'aguardando_interno', 1, v_ana);
  perform public.ticket_take_over(v_c, v_ana);
  select string_agg(t.status, ',' order by t.title) into v_t from public.tickets t where t.id in (v_a, v_b, v_c);
  select c.active_ticket_id into v_active from public.chat_conversations c where c.id = v_c63;
  insert into r values (v_t = 'aguardando_cliente,aguardando_interno,resolvido' and v_active = v_c,
    'T63a take_over em resolvido e aguardando_* não muda o status', v_t);
  j := public.create_ticket(p_conversation_id => v_c63, p_title => 'Cancelado', p_actor_user_id => v_ana,
         p_set_active => false);
  v_d := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_d, 'cancelado', 1, v_ana, null, 'Duplicado');
  perform pg_temp.expect_fail('T63b take_over em terminal',
    format('select public.ticket_take_over(%L, %L)', v_d, v_ana), 'P0001', 'TICKET_TERMINAL');
end
$$;

reset role;

-- ============================================================================
-- Retomada, chat e usuários (T70–T83)
-- ============================================================================
set role service_role;

do $$
declare
  v_ana    uuid := pg_temp.id('ana');
  v_leaver uuid := pg_temp.id('leaver');
  v_c70    uuid := pg_temp.id('c70');
  v_c71    uuid := pg_temp.id('c71');
  v_c80    uuid := pg_temp.id('c80');
  v_c82    uuid := pg_temp.id('c82');
  v_c83    uuid := pg_temp.id('c83');
  v_id     uuid;
  v_m      uuid;
  v_x      uuid;
  v_x2     uuid;
  v_cm     uuid;
  v_att    uuid;
  v_row    public.tickets%rowtype;
  v_before public.tickets%rowtype;
  v_hist   public.ticket_status_history%rowtype;
  v_t      text;
  v_n0     integer;
  v_n1     integer;
  v_n      integer;
  v_n2     integer;
  j        jsonb;
begin
  -- T70: aberto há 2 h, aguardando o cliente há 30 min.
  j := public.create_ticket(p_conversation_id => v_c70, p_title => 'Aguardando o cliente', p_actor_user_id => v_ana);
  v_id := (j #>> '{ticket,id}')::uuid;
  reset role;  -- postgres: o tempo passa
  perform pg_temp.shift_ticket(v_id, interval '2 hours');
  set local role service_role;
  perform public.ticket_transition(v_id, 'aguardando_cliente', 1, v_ana);
  reset role;
  update public.tickets set sla_paused_at = now() - interval '30 minutes' where id = v_id;
  set local role service_role;
  select * into v_before from public.tickets t where t.id = v_id;

  v_m := pg_temp.msg(v_c70, 'inbound', 'contact', 'delivered', now() - interval '1 hour');
  select * into v_row from public.tickets t where t.id = v_id;
  select m.ticket_id into v_x from public.chat_messages m where m.id = v_m;
  insert into r values (v_row.status = 'aguardando_cliente' and v_row.version = v_before.version and v_x = v_id,
    'T70a inbound anterior à pausa (retry atrasado) não retoma', v_row.status);

  perform pg_temp.msg(v_c70, 'inbound', 'contact', 'delivered', now());
  select * into v_row from public.tickets t where t.id = v_id;
  select * into v_hist from public.ticket_status_history h
   where h.ticket_id = v_id and h.from_status = 'aguardando_cliente' and h.to_status = 'em_atendimento';
  insert into r values (
    v_row.status = 'em_atendimento' and v_row.version = v_before.version + 1
    and v_row.sla_paused_at is null and v_row.sla_paused_seconds = 1800
    and v_row.resolution_due_at = v_before.resolution_due_at + interval '30 minutes'
    and v_row.first_response_due_at = v_before.first_response_due_at
    and v_hist.actor_type = 'system' and v_hist.actor_user_id is null and v_hist.actor_token_id is null,
    'T70b inbound em aguardando_cliente → em_atendimento, ator system, pausa somada',
    format('%s | pausa=%s s | ator=%s', v_row.status, v_row.sla_paused_seconds, coalesce(v_hist.actor_type, '<sem history>')));

  j := public.create_ticket(p_conversation_id => v_c71, p_title => 'Resolvido em foco', p_actor_user_id => v_ana);
  v_id := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_id, 'em_atendimento', 1, v_ana);
  perform public.ticket_transition(v_id, 'resolvido', 2, v_ana);
  v_m := pg_temp.msg(v_c71, 'inbound', 'contact', 'delivered', now());
  select * into v_row from public.tickets t where t.id = v_id;
  select m.ticket_id into v_x from public.chat_messages m where m.id = v_m;
  insert into r values (v_row.status = 'resolvido' and v_row.reopened_count = 0 and v_x = v_id,
    'T70c inbound em resolvido não reabre', v_row.status || ' | reaberto=' || v_row.reopened_count);

  -- T80
  perform public.create_ticket(p_conversation_id => v_c80, p_title => 'Conversa com ticket', p_actor_user_id => v_ana);
  perform pg_temp.msg(v_c80, 'inbound', 'contact', 'delivered');
  perform pg_temp.msg(v_c80, 'outbound', 'agent', 'sent');
  select count(*) into v_n0 from public.chat_messages m where m.conversation_id = v_c80 and not m.is_deleted;
  perform pg_temp.expect_fail('T80a clear com ticket → CONVERSATION_HAS_TICKETS',
    format('select public.clear_chat_conversation(%L)', v_c80), 'P0001', 'CONVERSATION_HAS_TICKETS');
  select count(*) into v_n from public.chat_messages m where m.conversation_id = v_c80 and not m.is_deleted;
  insert into r values (v_n0 = 2 and v_n = v_n0, 'T80b clear recusado não apaga nada', v_n0 || ' → ' || v_n);

  -- T81
  perform pg_temp.expect_fail('T81 DELETE de conversa com ticket',
    format('delete from public.chat_conversations where id = %L', v_c80), '23503', 'tickets_conversation_id_fkey');

  -- T82
  update public.chat_conversations set status = 'resolved' where id = v_c82;
  perform pg_temp.msg(v_c82, 'inbound', 'contact', 'delivered');
  select c.status into v_t from public.chat_conversations c where c.id = v_c82;
  insert into r values (v_t = 'bot', 'T82a conversa resolved + inbound → bot', v_t);
  update public.chat_conversations set status = 'resolved' where id = v_c82;
  perform pg_temp.msg(v_c82, 'outbound', 'agent', 'sent');
  select c.status into v_t from public.chat_conversations c where c.id = v_c82;
  insert into r values (v_t = 'resolved', 'T82b outbound não muda o status', v_t);

  -- T83: responsável, criador, autor, quem anexou e ator da trilha.
  j := public.create_ticket(p_conversation_id => v_c83, p_title => 'Ticket de quem sai', p_actor_user_id => v_leaver,
         p_take_over => true);
  v_id := (j #>> '{ticket,id}')::uuid;
  insert into public.ticket_comments (ticket_id, author_user_id, body)
  values (v_id, v_leaver, 'Anotação de quem sai') returning id into v_cm;
  insert into public.ticket_attachments (ticket_id, object_key, file_name, mime, size_bytes, sha256, uploaded_by_user_id)
  values (v_id, 'tickets/' || v_id || '/' || gen_random_uuid(), 'log.txt', 'text/plain', 10, repeat('a', 64), v_leaver)
  returning id into v_att;
  select count(*) into v_n0 from public.ticket_status_history h where h.actor_user_id = v_leaver;
  select count(*) into v_n1 from public.ticket_events e where e.actor_user_id = v_leaver;

  perform public.delete_app_user(pg_temp.id('admin'), v_leaver);

  select count(*) into v_n from public.app_users u where u.id = v_leaver;
  select * into v_row from public.tickets t where t.id = v_id;
  select c.author_user_id into v_x from public.ticket_comments c where c.id = v_cm;
  select a.uploaded_by_user_id into v_x2 from public.ticket_attachments a where a.id = v_att;
  insert into r values (
    v_n = 0 and v_row.assigned_to_user_id is null and v_row.created_by_user_id is null
    and v_x is null and v_x2 is null,
    'T83a delete_app_user de quem é responsável, criador e autor passa; FKs nulas',
    format('usuário=%s responsável=%s criador=%s autor=%s anexo=%s', v_n,
      coalesce(v_row.assigned_to_user_id::text, 'null'), coalesce(v_row.created_by_user_id::text, 'null'),
      coalesce(v_x::text, 'null'), coalesce(v_x2::text, 'null')));
  select count(*) into v_n from public.ticket_status_history h where h.actor_user_id = v_leaver;
  select count(*) into v_n2 from public.ticket_events e where e.actor_user_id = v_leaver;
  insert into r values (v_n0 >= 2 and v_n = v_n0 and v_n1 >= 1 and v_n2 = v_n1,
    'T83b trilha intacta (sem FK de ator)', format('history %s→%s, events %s→%s', v_n0, v_n, v_n1, v_n2));
end
$$;

reset role;

-- ============================================================================
-- Satélites, view e ordem dos triggers (T90–T99)
-- ============================================================================
set role service_role;

do $$
declare
  v_ana   uuid := pg_temp.id('ana');
  v_tk05  uuid := pg_temp.id('tk05');
  v_tk20  uuid := pg_temp.id('tk20');
  v_q1    uuid := pg_temp.id('q1');
  v_c95   uuid := pg_temp.id('c95');
  v_cm    uuid;
  v_att   uuid;
  v_cat   uuid;
  v_cat1  uuid;
  v_cat2  uuid;
  v_q3    uuid;
  v_prod  uuid;
  v_s1    uuid;
  v_s2    uuid;
  v_s3    uuid;
  v_s4    uuid;
  v_s5    uuid;
  v_s6    uuid;
  v_s7    uuid;
  v_s8    uuid;
  v_first integer;
  v_res   integer;
  v_q     public.ticket_queue%rowtype;
  v_t     text;
  v_ts    timestamptz;
  j       jsonb;
begin
  -- T90
  perform pg_temp.expect_fail('T90a comentário sem autor',
    format('insert into public.ticket_comments (ticket_id, body) values (%L, ''Sem autor'')', v_tk05),
    'P0001', 'INVALID_ACTOR');
  insert into public.ticket_comments (ticket_id, author_user_id, body)
  values (v_tk05, v_ana, 'Primeira versão') returning id into v_cm;
  update public.ticket_comments set body = 'Segunda versão' where id = v_cm;
  select c.body, c.edited_at into v_t, v_ts from public.ticket_comments c where c.id = v_cm;
  insert into r values (v_t = 'Segunda versão' and v_ts = now(), 'T90b editar carimba edited_at',
    coalesce(v_t, '<null>') || ' | ' || coalesce(v_ts::text, '<null>'));
  update public.ticket_comments set deleted_at = now() where id = v_cm;
  select c.body, c.deleted_at into v_t, v_ts from public.ticket_comments c where c.id = v_cm;
  insert into r values (v_t is null and v_ts is not null, 'T90c apagar zera o body',
    coalesce(v_t, '<null>') || ' | ' || coalesce(v_ts::text, '<null>'));
  perform pg_temp.expect_fail('T90d editar comentário apagado',
    format('update public.ticket_comments set body = ''De volta'' where id = %L', v_cm), 'P0001', 'COMMENT_DELETED');
  perform pg_temp.expect_fail('T90e DELETE de comentário negado',
    format('delete from public.ticket_comments where id = %L', v_cm), '42501');

  -- T91
  insert into public.ticket_attachments (ticket_id, object_key, file_name, mime, size_bytes, sha256, uploaded_by_user_id)
  values (v_tk05, 'tickets/' || v_tk05 || '/' || gen_random_uuid(), 'print.png', 'image/png', 2048, repeat('b', 64), v_ana)
  returning id into v_att;
  insert into r values (v_att is not null, 'T91a anexo válido entra', '');
  perform pg_temp.expect_fail('T91b object_key de outro ticket',
    format('insert into public.ticket_attachments (ticket_id, object_key, file_name, mime, size_bytes, sha256) '
           'values (%L, %L, ''a.txt'', ''text/plain'', 1, %L)',
           v_tk05, 'tickets/' || v_tk20 || '/' || gen_random_uuid(), repeat('c', 64)),
    '23514', 'ticket_attachments_object_key_check');
  perform pg_temp.expect_fail('T91c sha256 inválido',
    format('insert into public.ticket_attachments (ticket_id, object_key, file_name, mime, size_bytes, sha256) '
           'values (%L, %L, ''a.txt'', ''text/plain'', 1, %L)',
           v_tk05, 'tickets/' || v_tk05 || '/' || gen_random_uuid(), upper(repeat('c', 64))),
    '23514', 'ticket_attachments_sha256_check');
  perform pg_temp.expect_fail('T91d bucket errado',
    format('insert into public.ticket_attachments (ticket_id, bucket, object_key, file_name, mime, size_bytes, sha256) '
           'values (%L, ''chat-media'', %L, ''a.txt'', ''text/plain'', 1, %L)',
           v_tk05, 'tickets/' || v_tk05 || '/' || gen_random_uuid(), repeat('c', 64)),
    '23514', 'ticket_attachments_bucket_check');
  perform pg_temp.expect_fail('T91e UPDATE de anexo negado',
    format('update public.ticket_attachments set file_name = ''outro.png'' where id = %L', v_att), '42501');
  perform pg_temp.expect_fail('T91f DELETE de anexo negado',
    format('delete from public.ticket_attachments where id = %L', v_att), '42501');

  -- T92
  insert into public.ticket_categories (name, product_id) values ('Financeiro', v_q1) returning id into v_cat;
  insert into public.ticket_categories (name, product_id, parent_id) values ('Boletos', v_q1, v_cat) returning id into v_cat1;
  perform pg_temp.expect_fail('T92a terceiro nível',
    format('insert into public.ticket_categories (name, product_id, parent_id) values (''Segunda via'', %L, %L)', v_q1, v_cat1),
    'P0001', 'CATEGORY_TOO_DEEP');
  perform pg_temp.expect_fail('T92b filha em outra fila',
    format('insert into public.ticket_categories (name, product_id, parent_id) values (''Nota fiscal'', %L, %L)',
           pg_temp.id('q2'), v_cat),
    'P0001', 'CATEGORY_PRODUCT_MISMATCH');
  perform pg_temp.expect_fail('T92c nome ativo repetido',
    format('insert into public.ticket_categories (name, product_id) values ('' financeiro '', %L)', v_q1),
    '23505', 'ticket_categories_name_active_uidx');
  perform pg_temp.expect_fail('T92d arquivar mãe com filha ativa',
    format('update public.ticket_categories set archived_at = now() where id = %L', v_cat),
    'P0001', 'CATEGORY_HAS_ACTIVE_CHILDREN');
  -- T92e–g: 20260926120000_categoria_trava_mae (a corrida R6 exige duas sessões:
  -- prova no PROGRESS). Aqui, as regras em série.
  update public.ticket_categories set archived_at = now() where id = v_cat1;
  update public.ticket_categories set archived_at = now() where id = v_cat;
  perform pg_temp.expect_fail('T92e filha nova sob mãe arquivada',
    format('insert into public.ticket_categories (name, product_id, parent_id) values (''Carnê'', %L, %L)', v_q1, v_cat),
    'P0001', 'CATEGORY_ARCHIVED');
  perform pg_temp.expect_fail('T92f reativar filha de mãe arquivada',
    format('update public.ticket_categories set archived_at = null where id = %L', v_cat1),
    'P0001', 'CATEGORY_ARCHIVED');
  insert into public.products (name) values ('Fila Tickets Gama') returning id into v_q3;
  insert into public.ticket_categories (name, product_id) values ('Relatórios Gama', v_q3) returning id into v_cat2;
  update public.ticket_categories set archived_at = now() where id = v_cat2;
  update public.products set archived_at = now() where id = v_q3;
  perform pg_temp.expect_fail('T92g reativar categoria de fila arquivada',
    format('update public.ticket_categories set archived_at = null where id = %L', v_cat2),
    'P0001', 'PRODUCT_ARCHIVED');
  update public.ticket_categories set archived_at = null where id = v_cat;
  update public.ticket_categories set archived_at = null where id = v_cat1;
  insert into r values (
    (select count(*) from public.ticket_categories c where c.id in (v_cat, v_cat1) and c.archived_at is null) = 2,
    'T92h reativar a mãe e depois a filha', '');

  -- T93 (substitui o P01c de cadastros.sql)
  insert into public.products (name) values ('Fila Tickets Gama') returning id into v_prod;
  update public.products set name = 'Fila Tickets Gama Renomeada', color = 'teal' where id = v_prod;
  update public.products set archived_at = now() where id = v_prod;
  select p.name || '|' || p.color, p.archived_at into v_t, v_ts from public.products p where p.id = v_prod;
  insert into r values (v_t = 'Fila Tickets Gama Renomeada|teal' and v_ts = now(),
    'T93a fila: nome, cor e arquivar pelo app', coalesce(v_t, '<null>') || ' | ' || coalesce(v_ts::text, '<null>'));
  perform pg_temp.expect_fail('T93b DELETE de fila negado',
    format('delete from public.products where id = %L', v_prod), '42501');

  -- T95: casos fabricados, todos na conversa 95 (só o último em foco).
  j := public.create_ticket(p_conversation_id => v_c95, p_title => 'Q1 correndo vencido', p_priority => 'critica',
         p_actor_user_id => v_ana, p_set_active => false);
  v_s1 := (j #>> '{ticket,id}')::uuid;
  j := public.create_ticket(p_conversation_id => v_c95, p_title => 'Q2 pausado antes do prazo', p_priority => 'critica',
         p_actor_user_id => v_ana, p_set_active => false);
  v_s2 := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_s2, 'aguardando_cliente', 1, v_ana);
  j := public.create_ticket(p_conversation_id => v_c95, p_title => 'Q3 pausado depois do prazo', p_priority => 'critica',
         p_actor_user_id => v_ana, p_set_active => false);
  v_s3 := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_s3, 'aguardando_cliente', 1, v_ana);
  j := public.create_ticket(p_conversation_id => v_c95, p_title => 'Q4 1ª resposta vence na pausa', p_priority => 'critica',
         p_actor_user_id => v_ana, p_set_active => false);
  v_s4 := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_s4, 'aguardando_cliente', 1, v_ana);
  j := public.create_ticket(p_conversation_id => v_c95, p_title => 'Q5 risco a 85%', p_priority => 'critica',
         p_actor_user_id => v_ana, p_set_active => false);
  v_s5 := (j #>> '{ticket,id}')::uuid;
  j := public.create_ticket(p_conversation_id => v_c95, p_title => 'Q6 75% ainda sem risco', p_priority => 'critica',
         p_actor_user_id => v_ana, p_set_active => false);
  v_s6 := (j #>> '{ticket,id}')::uuid;
  j := public.create_ticket(p_conversation_id => v_c95, p_title => 'Q7 resolvido', p_actor_user_id => v_ana,
         p_set_active => false);
  v_s7 := (j #>> '{ticket,id}')::uuid;
  perform public.ticket_transition(v_s7, 'em_atendimento', 1, v_ana);
  perform public.ticket_transition(v_s7, 'resolvido', 2, v_ana);
  j := public.create_ticket(p_conversation_id => v_c95, p_title => 'Q8 com mensagens', p_priority => 'critica',
         p_actor_user_id => v_ana);
  v_s8 := (j #>> '{ticket,id}')::uuid;
  select t.sla_first_response_minutes, t.sla_resolution_minutes into v_first, v_res
    from public.tickets t where t.id = v_s1;

  reset role;  -- postgres: o tempo passa
  perform pg_temp.shift_ticket(v_s1, make_interval(mins => v_res + 60));
  perform pg_temp.shift_ticket(v_s2, make_interval(mins => v_res + 60));
  update public.tickets
     set first_responded_at = created_at + interval '1 minute',
         sla_paused_at = resolution_due_at - interval '30 minutes'
   where id = v_s2;
  perform pg_temp.shift_ticket(v_s3, make_interval(mins => v_res + 60));
  update public.tickets
     set first_responded_at = created_at + interval '1 minute',
         sla_paused_at = resolution_due_at + interval '30 minutes'
   where id = v_s3;
  perform pg_temp.shift_ticket(v_s4, make_interval(mins => v_first + 30));
  update public.tickets set sla_paused_at = created_at + interval '10 minutes' where id = v_s4;
  perform pg_temp.shift_ticket(v_s5, make_interval(secs => v_first * 60 * 0.85));
  perform pg_temp.shift_ticket(v_s6, make_interval(secs => v_first * 60 * 0.75));
  perform pg_temp.shift_ticket(v_s8, interval '30 minutes');
  set local role service_role;
  perform pg_temp.msg(v_c95, 'inbound', 'contact', 'delivered', now() - interval '20 minutes');
  perform pg_temp.msg(v_c95, 'inbound', 'contact', 'delivered', now() - interval '5 minutes');
  perform pg_temp.msg(v_c95, 'outbound', 'agent', 'sent', now() - interval '2 minutes');

  select * into v_q from public.ticket_queue q where q.id = v_s1;
  insert into r values (
    v_q.sla_mode = 'running' and v_q.first_response_overdue and v_q.resolution_overdue and v_q.sla_breached
    and not v_q.sla_at_risk and v_q.next_due_at = v_q.first_response_due_at,
    'T95a correndo e vencido: estourou', format('1ª=%s sol=%s estourou=%s risco=%s', v_q.first_response_overdue,
      v_q.resolution_overdue, v_q.sla_breached, v_q.sla_at_risk));
  select * into v_q from public.ticket_queue q where q.id = v_s2;
  insert into r values (
    v_q.sla_mode = 'paused' and v_q.resolution_due_at < now() and not v_q.resolution_overdue
    and not v_q.first_response_overdue and not v_q.sla_breached and not v_q.sla_at_risk and v_q.next_due_at is null,
    'T95b pausado antes do prazo: não estourou', format('sol=%s estourou=%s próximo=%s', v_q.resolution_overdue,
      v_q.sla_breached, coalesce(v_q.next_due_at::text, '<null>')));
  select * into v_q from public.ticket_queue q where q.id = v_s3;
  insert into r values (v_q.sla_mode = 'paused' and v_q.resolution_overdue and v_q.sla_breached,
    'T95c pausado depois do prazo: estourou', format('sol=%s estourou=%s', v_q.resolution_overdue, v_q.sla_breached));
  select * into v_q from public.ticket_queue q where q.id = v_s4;
  insert into r values (
    v_q.sla_mode = 'paused' and v_q.first_response_overdue and not v_q.resolution_overdue and v_q.sla_breached
    and v_q.next_due_at = v_q.first_response_due_at,
    'T95d 1ª resposta vencida durante a pausa (a 1ª resposta não pausa)',
    format('1ª=%s sol=%s estourou=%s', v_q.first_response_overdue, v_q.resolution_overdue, v_q.sla_breached));
  select * into v_q from public.ticket_queue q where q.id = v_s5;
  insert into r values (not v_q.sla_breached and v_q.sla_at_risk and v_q.next_due_at = v_q.first_response_due_at,
    'T95e risco a 85% do prazo', format('estourou=%s risco=%s', v_q.sla_breached, v_q.sla_at_risk));
  select * into v_q from public.ticket_queue q where q.id = v_s6;
  insert into r values (not v_q.sla_breached and not v_q.sla_at_risk,
    'T95f a 75% do prazo ainda sem risco', format('estourou=%s risco=%s', v_q.sla_breached, v_q.sla_at_risk));
  select * into v_q from public.ticket_queue q where q.id = v_s7;
  insert into r values (
    v_q.status = 'resolvido' and v_q.next_due_at is null and not v_q.sla_breached and not v_q.sla_at_risk,
    'T95g next_due_at nulo em resolvido', coalesce(v_q.next_due_at::text, '<null>'));
  select * into v_q from public.ticket_queue q where q.id = v_s8;
  insert into r values (v_q.last_inbound_at = now() - interval '5 minutes', 'T95h last_inbound_at',
    coalesce(v_q.last_inbound_at::text, '<null>'));

  -- T95i–k: replied_after_resolve (20260926130000_fila_respondeu_apos_resolver).
  select * into v_q from public.ticket_queue q where q.id = v_s7;
  insert into r values (v_q.replied_after_resolve is false, 'T95i resolvido sem resposta do cliente: false, nunca nulo',
    coalesce(v_q.replied_after_resolve::text, '<null>'));
  select * into v_q from public.ticket_queue q where q.id = v_s8;
  insert into r values (v_q.replied_after_resolve is false, 'T95j ativo com mensagem do cliente: false',
    coalesce(v_q.replied_after_resolve::text, '<null>'));
  perform public.ticket_transition(v_s8, 'em_atendimento', pg_temp.ver(v_s8), v_ana);
  perform public.ticket_transition(v_s8, 'resolvido', pg_temp.ver(v_s8), v_ana);
  reset role;  -- postgres: resolvido há 10 min, antes da mensagem de 5 min atrás
  update public.tickets
     set resolved_at = resolved_at - interval '10 minutes', sla_paused_at = sla_paused_at - interval '10 minutes'
   where id = v_s8;
  set local role service_role;
  select * into v_q from public.ticket_queue q where q.id = v_s8;
  insert into r values (v_q.replied_after_resolve, 'T95k cliente respondeu depois de resolver: true',
    format('resolvido %s, última do cliente %s', v_q.resolved_at, v_q.last_inbound_at));

  -- T99
  select string_agg(t.tgname::text, ',' order by t.tgname::text collate "C") into v_t
    from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.chat_messages'::regclass
     and not t.tgisinternal
     and (t.tgtype::integer & 2) = 0    -- AFTER
     and (t.tgtype::integer & 64) = 0   -- não INSTEAD OF
     and (t.tgtype::integer & 4) <> 0;  -- INSERT
  insert into r values (
    v_t = 'trg_chat_messages_ensure_contact_activity,trg_chat_messages_increment_unread,trg_chat_messages_ticket_sla_ins'
    and 'trg_chat_messages_ensure_contact_activity' collate "C" < 'trg_chat_messages_increment_unread' collate "C"
    and 'trg_chat_messages_increment_unread' collate "C" < 'trg_chat_messages_ticket_sla_ins' collate "C",
    'T99 AFTER INSERT de chat_messages: ensure_contact_activity < increment_unread < ticket_sla_ins', v_t);
end
$$;

reset role;

-- ============================================================================
-- Navegador (T09): nenhuma tabela, view nem RPC de ticket para anon e
-- authenticated; o chat continua legível para authenticated (T29 do baseline).
-- ============================================================================
do $$
declare
  v_role text;
  v_sql  text;
  v_res  text;
  v_fail text;
  v_n    integer;
  v_n2   integer;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    v_fail := null;
    execute format('set local role %I', v_role);
    foreach v_sql in array array[
      'select * from public.ticket_statuses limit 1',
      'select * from public.ticket_status_transitions limit 1',
      'select * from public.sla_policies limit 1',
      'select * from public.ticket_categories limit 1',
      'select * from public.tickets limit 1',
      'select * from public.ticket_status_history limit 1',
      'select * from public.ticket_events limit 1',
      'select * from public.ticket_comments limit 1',
      'select * from public.ticket_attachments limit 1',
      'select * from public.ticket_queue limit 1',
      'select public.create_ticket(null, null)',
      'select public.ticket_update(null, null, null)',
      'select public.ticket_transition(null, null, null)',
      'select public.ticket_assign(null, null)',
      'select public.ticket_set_active(null)',
      'select public.ticket_take_over(null, null)'
    ] loop
      v_res := pg_temp.fails(v_sql, '42501');
      if v_res is not null then
        v_fail := concat_ws('; ', v_fail, v_sql || ' → ' || v_res);
      end if;
    end loop;
    reset role;
    insert into r values (v_fail is null, 'T09a ' || v_role || ' sem tabela, view nem RPC de ticket',
      coalesce(v_fail, '16 × 42501'));
  end loop;

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"role":"authenticated","app_role":"member"}', true);
  select count(*) into v_n from public.chat_messages m where m.ticket_id is not null;
  select count(*) into v_n2 from public.chat_conversations c where c.active_ticket_id is not null;
  perform set_config('request.jwt.claims', '', true);
  reset role;
  insert into r values (v_n > 0 and v_n2 > 0, 'T09b authenticated ainda lê o chat, com ticket_id e active_ticket_id',
    format('%s mensagem(ns) carimbada(s), %s conversa(s) com foco', v_n, v_n2));
end
$$;

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select string_agg(teste, '; ' order by teste) into v_falhas from r where not ok;
  if v_falhas is not null then
    raise exception 'testes de tickets falharam: %', v_falhas;
  end if;
  raise notice 'testes de tickets: % caso(s), todos ok', (select count(*) from r);
end $$;

rollback;
