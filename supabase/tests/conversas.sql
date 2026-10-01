-- ============================================================================
-- Testes do banco das conversas da IA (20261001120000): o token como autor da
-- mensagem (chat_messages.sent_by_token_id, com o remetente amarrado ao tipo
-- do token), a nota da IA na abertura do ticket e o handoff bot→human
-- (conversation_handoff). Rodados por scripts/db-local-test.sh; tudo em
-- ROLLBACK.
--
-- O preparo roda como postgres; os casos, como service_role (o papel do app).
-- Volta a postgres só para o que o app não faz: apagar um token (M15) e ler
-- como o operador logado (P06).
--
-- Não coberto aqui, porque exige duas sessões: dois handoffs simultâneos (o 2º
-- espera a trava da conversa e sai com changed=false) e handoff × mensagem do
-- cliente numa conversa resolvida. A prova é manual, com duas sessões psql, e
-- o resultado está no PROGRESS (entrada do PR 9).
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
    raise exception 'conversas.sql: id % ausente', p_k;
  end if;
  return v_id;
end
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

-- O contato nasce com "+" no telefone e a conversa sem: external_id (o
-- endereço do canal) e contact_phone ficam diferentes, e o H02 distingue os dois.
create function pg_temp.new_conv(p_n integer) returns uuid
language plpgsql as $$
declare
  v_phone   text := '55119900006' || lpad(p_n::text, 2, '0');
  v_contact uuid;
  v_id      uuid;
begin
  v_contact := (public.resolve_contact_identity('+' || v_phone, 'Contato Conversas ' || p_n, 'whatsapp', null, false) ->> 'contactId')::uuid;
  insert into public.chat_conversations (integration_id, contact_id, external_id, contact_phone, contact_name)
  values (pg_temp.id('integration'), v_contact, v_phone, v_phone, 'Contato Conversas ' || p_n)
  returning id into v_id;
  return v_id;
end
$$;

-- Quantos pedidos de handoff a trilha do ticket guarda.
create function pg_temp.handoffs(p_ticket uuid) returns integer
language sql as $$
  select count(*)::integer from public.ticket_events e
   where e.ticket_id = p_ticket and e.event_type = 'ticket.handoff_requested'
$$;

-- Quantas notas de handoff a conversa tem.
create function pg_temp.notes(p_conv uuid) returns integer
language sql as $$
  select count(*)::integer from public.chat_messages m
   where m.conversation_id = p_conv and m.type = 'note' and m.metadata @> '{"handoff": true}'
$$;

create function pg_temp.conv_status(p_conv uuid) returns text
language sql as $$
  select c.status from public.chat_conversations c where c.id = p_conv
$$;

grant execute on function pg_temp.id(text), pg_temp.expect_fail(text, text, text, text),
  pg_temp.handoffs(uuid), pg_temp.notes(uuid), pg_temp.conv_status(uuid)
  to service_role;
grant execute on function pg_temp.fails(text, text, text) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Preparo (postgres)
-- ---------------------------------------------------------------------------
-- A instância é única (provider único): reusa a de dev, se houver.
insert into public.chat_integrations (name, provider, config)
values ('Teste Conversas', 'uazapi', '{"apiUrl":"https://x.test"}')
on conflict (provider) do nothing;
insert into ids select 'integration', i.id from public.chat_integrations i where i.provider = 'uazapi';

insert into ids
select 'ana', id from public.create_app_user('cv-ana@x.test', 'Analista Ana', '12345678', 'member', 'slate');

with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, scopes, actor_type)
  values ('Conversas IA', md5(random()::text) || md5(random()::text), 'crmsuporte_c1', '{conversations:*}', 'ai')
  returning id
) insert into ids select 'token_ai', id from t;
with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, scopes)
  values ('Conversas integração', md5(random()::text) || md5(random()::text), 'crmsuporte_c2', '{conversations:*}')
  returning id
) insert into ids select 'token_api', id from t;
with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, actor_type, revoked_at)
  values ('Conversas revogado', md5(random()::text) || md5(random()::text), 'crmsuporte_c3', 'ai', now())
  returning id
) insert into ids select 'token_revoked', id from t;
with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, actor_type, expires_at)
  values ('Conversas vencido', md5(random()::text) || md5(random()::text), 'crmsuporte_c4', 'ai', now() - interval '1 hour')
  returning id
) insert into ids select 'token_expired', id from t;
-- Só escreve mensagem: apagá-lo esbarra na FK da mensagem, e em mais nada (M15).
with t as (
  insert into public.api_tokens (name, token_hash, token_prefix, actor_type)
  values ('Conversas só mensagem', md5(random()::text) || md5(random()::text), 'crmsuporte_c5', 'ai')
  returning id
) insert into ids select 'token_msg', id from t;

insert into ids values
  ('conv_msg', pg_temp.new_conv(1)), ('conv_1', pg_temp.new_conv(2)), ('conv_2', pg_temp.new_conv(3)),
  ('conv_3', pg_temp.new_conv(4)), ('conv_4', pg_temp.new_conv(5)), ('conv_5', pg_temp.new_conv(6)),
  ('conv_6', pg_temp.new_conv(7)), ('conv_n1', pg_temp.new_conv(8)), ('conv_n2', pg_temp.new_conv(9)),
  ('conv_7', pg_temp.new_conv(10)), ('conv_8', pg_temp.new_conv(11)), ('conv_9', pg_temp.new_conv(12));

set role service_role;

-- ---------------------------------------------------------------------------
-- M. O token como autor da mensagem
-- ---------------------------------------------------------------------------
do $$
declare
  v_conv  uuid := pg_temp.id('conv_msg');
  v_ai    uuid := pg_temp.id('token_ai');
  v_api   uuid := pg_temp.id('token_api');
  v_ana   uuid := pg_temp.id('ana');
  v_tk    uuid;
  v_in    uuid;
  v_msg   uuid;
  v_tok   uuid;
  v_user  uuid;
  v_ai_at timestamptz;
  v_hu_at timestamptz;
  v_ins   text := 'insert into public.chat_messages '
               || '(conversation_id, direction, sender_type, type, content, delivery_status, sent_by_user_id, sent_by_token_id) '
               || 'values (%L, %L, %L, ''text'', ''mensagem de teste'', ''sent'', %L, %L)';
begin
  -- Um ticket em foco, para as mensagens caírem nele.
  v_tk := (public.create_ticket(p_conversation_id => v_conv, p_title => 'Ticket das mensagens',
                                p_actor_token_id => v_ai) -> 'ticket' ->> 'id')::uuid;

  -- Integração primeiro: se ela carimbasse a 1ª resposta da IA, o M03 não veria.
  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status, sent_by_token_id)
  values (v_conv, 'outbound', 'system', 'text', 'Aviso automático', 'sent', v_api)
  returning sent_by_token_id, ticket_id into v_tok, v_in;
  insert into r values (v_tok is not distinct from v_api and v_in is not distinct from v_tk,
    'M01 mensagem de um token de integração (system) guarda o token e cai no ticket em foco',
    coalesce(v_tok::text, '<null>'));
  select t.first_ai_response_at, t.first_responded_at into v_ai_at, v_hu_at from public.tickets t where t.id = v_tk;
  insert into r values (v_ai_at is null and v_hu_at is null,
    'M02 mensagem de integração não conta como 1ª resposta, nem da IA nem humana',
    coalesce(v_ai_at::text, '<null>') || ' | ' || coalesce(v_hu_at::text, '<null>'));

  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status, sent_by_token_id)
  values (v_conv, 'outbound', 'ai', 'text', 'Resposta da IA', 'sent', v_ai)
  returning id, sent_by_token_id, sent_by_user_id into v_msg, v_tok, v_user;
  insert into r values (v_tok is not distinct from v_ai and v_user is null,
    'M03 mensagem da IA guarda o token que a enviou',
    coalesce(v_tok::text, '<null>') || ' | ' || coalesce(v_user::text, '<null>'));
  select t.first_ai_response_at, t.first_responded_at into v_ai_at, v_hu_at from public.tickets t where t.id = v_tk;
  insert into r values (v_ai_at is not null and v_hu_at is null,
    'M04 mensagem da IA conta como 1ª resposta da IA, nunca como a humana',
    coalesce(v_ai_at::text, '<null>') || ' | ' || coalesce(v_hu_at::text, '<null>'));

  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status, sent_by_token_id)
  values (v_conv, 'outbound', 'ai', 'note', 'Nota interna da IA', 'sent', v_ai)
  returning sent_by_token_id into v_tok;
  insert into r values (v_tok is not distinct from v_ai, 'M05 nota interna assinada pelo token é aceita',
    coalesce(v_tok::text, '<null>'));

  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status, sent_by_user_id)
  values (v_conv, 'outbound', 'agent', 'text', 'Resposta da analista', 'sent', v_ana)
  returning sent_by_token_id, sent_by_user_id into v_tok, v_user;
  insert into r values (v_tok is null and v_user is not distinct from v_ana, 'M06 mensagem do analista segue sem token',
    coalesce(v_tok::text, '<null>') || ' | ' || coalesce(v_user::text, '<null>'));

  perform pg_temp.expect_fail('M07 mensagem com dois autores (usuário e token)',
    format(v_ins, v_conv, 'outbound', 'ai', v_ana, v_ai), '23514', 'chat_messages_one_author');
  perform pg_temp.expect_fail('M08 token escrevendo como analista (agent)',
    format(v_ins, v_conv, 'outbound', 'agent', null, v_ai), 'P0001', 'INVALID_SENDER');
  perform pg_temp.expect_fail('M09 token escrevendo como celular da empresa (device)',
    format(v_ins, v_conv, 'outbound', 'device', null, v_ai), 'P0001', 'INVALID_SENDER');
  perform pg_temp.expect_fail('M10 token escrevendo como o cliente (contact)',
    format(v_ins, v_conv, 'inbound', 'contact', null, v_ai), 'P0001', 'INVALID_SENDER');
  perform pg_temp.expect_fail('M11 token de integração escrevendo como IA',
    format(v_ins, v_conv, 'outbound', 'ai', null, v_api), 'P0001', 'INVALID_SENDER');
  perform pg_temp.expect_fail('M12 token da IA escrevendo como integração (system)',
    format(v_ins, v_conv, 'outbound', 'system', null, v_ai), 'P0001', 'INVALID_SENDER');
  perform pg_temp.expect_fail('M13 token que não existe',
    format(v_ins, v_conv, 'outbound', 'ai', null, gen_random_uuid()), '23503', 'chat_messages_sent_by_token_id_fkey');

  perform pg_temp.expect_fail('M14 o app não troca o autor depois do INSERT',
    format('update public.chat_messages set sent_by_token_id = %L where id = %L', v_api, v_msg), '42501');

  -- Para o M15: o token que só escreveu esta mensagem.
  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status, sent_by_token_id)
  values (v_conv, 'outbound', 'ai', 'text', 'De um token só de mensagem', 'sent', pg_temp.id('token_msg'));
end $$;

-- ---------------------------------------------------------------------------
-- N. Mensagem solta da IA na abertura do ticket (create_ticket)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ai  uuid := pg_temp.id('token_ai');
  v_ana uuid := pg_temp.id('ana');
  v_n1  uuid := pg_temp.id('conv_n1');
  v_n2  uuid := pg_temp.id('conv_n2');
  v_row public.tickets%rowtype;
  j     jsonb;
begin
  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status, sent_by_token_id, created_at)
  values (v_n1, 'outbound', 'ai', 'note', 'Nota solta da IA', 'sent', v_ai, now() - interval '10 minutes');
  j := public.create_ticket(p_conversation_id => v_n1, p_title => 'Só a nota da IA', p_actor_user_id => v_ana);
  select * into v_row from public.tickets t where t.id = (j #>> '{ticket,id}')::uuid;
  insert into r values (
    (j ->> 'linked_messages')::integer is not distinct from 1 and v_row.id is not null
    and v_row.first_ai_response_at is null and v_row.first_responded_at is null,
    'N01 nota da IA solta entra no ticket e não conta como 1ª resposta da IA',
    format('linked=%s | 1ª resposta da IA %s', j ->> 'linked_messages', coalesce(v_row.first_ai_response_at::text, '<null>')));

  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status, sent_by_token_id, created_at)
  values (v_n2, 'outbound', 'ai', 'text', 'Resposta solta da IA', 'sent', v_ai, now() - interval '10 minutes');
  j := public.create_ticket(p_conversation_id => v_n2, p_title => 'Já respondido pela IA', p_actor_user_id => v_ana);
  select * into v_row from public.tickets t where t.id = (j #>> '{ticket,id}')::uuid;
  insert into r values (
    (j ->> 'linked_messages')::integer is not distinct from 1
    and v_row.first_ai_response_at is not distinct from v_row.created_at and v_row.first_responded_at is null,
    'N02 resposta da IA já entregue e vinculada conta na abertura, só como a da IA',
    format('linked=%s | 1ª resposta da IA %s', j ->> 'linked_messages', coalesce(v_row.first_ai_response_at::text, '<null>')));
end $$;

-- ---------------------------------------------------------------------------
-- H. conversation_handoff
-- ---------------------------------------------------------------------------
do $$
declare
  v_ai   uuid := pg_temp.id('token_ai');
  v_api  uuid := pg_temp.id('token_api');
  v_ana  uuid := pg_temp.id('ana');
  v_c1   uuid := pg_temp.id('conv_1');
  v_c2   uuid := pg_temp.id('conv_2');
  v_c3   uuid := pg_temp.id('conv_3');
  v_c4   uuid := pg_temp.id('conv_4');
  v_c5   uuid := pg_temp.id('conv_5');
  v_c6   uuid := pg_temp.id('conv_6');
  v_c7   uuid := pg_temp.id('conv_7');
  v_c8   uuid := pg_temp.id('conv_8');
  v_c9   uuid := pg_temp.id('conv_9');
  v_keys constant text[] := array['changed', 'conversation_external_id', 'conversation_id', 'note_id', 'status', 'ticket_id'];
  v_a    uuid;
  v_b    uuid;
  v_c    uuid;
  v_d    uuid;
  v_e    uuid;
  v_f    uuid;
  v_ver  integer;
  v_h    text;
  v_det  text;
  v_act  uuid;
  v_row  public.tickets%rowtype;
  v_conv public.chat_conversations%rowtype;
  j      jsonb;
  e      record;
  n      public.chat_messages%rowtype;
begin
  -- Conversa sem ticket ------------------------------------------------------
  update public.chat_conversations set updated_at = now() - interval '1 day' where id = v_c1;
  j := public.conversation_handoff(v_c1, v_ai, 'Cliente pediu um atendente');
  select * into v_conv from public.chat_conversations c where c.id = v_c1;
  insert into r values (
    j -> 'changed' = 'true'::jsonb and j ->> 'status' = 'human' and j -> 'ticket_id' = 'null'::jsonb
    and (j ->> 'conversation_id')::uuid = v_c1 and v_conv.status = 'human',
    'H01 bot → human numa conversa sem ticket', j::text);
  insert into r values (v_conv.updated_at = now(), 'H01b o handoff carimba updated_at da conversa', v_conv.updated_at::text);
  insert into r values (
    (select array_agg(k order by k) from jsonb_object_keys(j) k) = v_keys
    and j ->> 'conversation_external_id' = v_conv.external_id and v_conv.external_id <> v_conv.contact_phone,
    'H02 a resposta traz só o combinado, e o endereço do canal (não o telefone do contato)', j::text);

  select * into n from public.chat_messages m where m.id = (j ->> 'note_id')::uuid;
  insert into r values (
    n.conversation_id = v_c1 and n.type = 'note' and n.direction = 'outbound' and n.sender_type = 'ai'
    and n.sent_by_token_id = v_ai and n.sent_by_user_id is null and n.delivery_status = 'sent'
    and n.content = 'Cliente pediu um atendente' and n.ticket_id is null and n.external_id is null
    and n.metadata = '{"handoff": true}'::jsonb,
    'H02b o handoff deixa uma nota interna assinada pelo token, com o motivo (sem ticket, fica solta)',
    coalesce(n.content, '<sem nota>') || ' | ' || coalesce(n.sender_type, '<null>'));
  insert into r values (
    v_conv.last_message_at is null and v_conv.last_message_preview is null,
    'H02c a nota não vira prévia nem reordena a lista',
    coalesce(v_conv.last_message_preview, '<null>'));

  update public.chat_conversations set updated_at = now() - interval '1 day' where id = v_c1;
  j := public.conversation_handoff(v_c1, v_ai, 'Cliente pediu um atendente');
  insert into r values (
    j -> 'changed' = 'false'::jsonb and j ->> 'status' = 'human' and j -> 'ticket_id' = 'null'::jsonb
    and j -> 'note_id' = 'null'::jsonb and pg_temp.conv_status(v_c1) = 'human' and pg_temp.notes(v_c1) = 1,
    'H03 conversa já com um humano: changed=false, sem outra nota', j::text);
  insert into r values (
    (select c.updated_at = now() - interval '1 day' from public.chat_conversations c where c.id = v_c1)
    and (select array_agg(k order by k) from jsonb_object_keys(j) k) = v_keys,
    'H03b o no-op não regrava a conversa e devolve as mesmas chaves', j::text);

  -- Mensagem nova do cliente não devolve a conversa à IA (só resolved→bot).
  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status)
  values (v_c1, 'inbound', 'contact', 'text', 'Alguém aí?', 'delivered');
  insert into r values (pg_temp.conv_status(v_c1) = 'human',
    'H04 mensagem do cliente depois do handoff não devolve a conversa à IA', pg_temp.conv_status(v_c1));

  -- A analista abre o ticket depois: a nota do handoff entra nele, sem contar
  -- como resposta da IA ao cliente.
  j := public.create_ticket(p_conversation_id => v_c1, p_title => 'Aberto depois do handoff', p_actor_user_id => v_ana);
  select * into v_row from public.tickets t where t.id = (j #>> '{ticket,id}')::uuid;
  insert into r values (
    (j ->> 'linked_messages')::integer is not distinct from 2 and v_row.first_ai_response_at is null
    and (select count(*) from public.chat_messages m
          where m.conversation_id = v_c1 and m.type = 'note' and m.ticket_id = v_row.id) = 1,
    'H04b ticket aberto depois: a nota do handoff entra nele e não conta como 1ª resposta da IA',
    format('linked=%s | 1ª resposta da IA %s', j ->> 'linked_messages', coalesce(v_row.first_ai_response_at::text, '<null>')));

  -- Ticket em foco -----------------------------------------------------------
  v_a := (public.create_ticket(p_conversation_id => v_c2, p_title => 'Ticket em foco',
                               p_actor_token_id => v_ai) -> 'ticket' ->> 'id')::uuid;
  v_b := (public.create_ticket(p_conversation_id => v_c2, p_title => 'Outro assunto', p_actor_token_id => v_ai,
                               p_set_active => false) -> 'ticket' ->> 'id')::uuid;
  select t.version into v_ver from public.tickets t where t.id = v_a;

  j := public.conversation_handoff(v_c2, v_ai, '  Dúvida de cobrança fora do meu alcance  ',
                                   '  Cliente recebeu dois boletos no mês.  ');
  select ev.actor_type, ev.actor_token_id, ev.actor_user_id, ev.metadata into e
    from public.ticket_events ev
   where ev.ticket_id = v_a and ev.event_type = 'ticket.handoff_requested';
  insert into r values (
    j -> 'changed' = 'true'::jsonb and (j ->> 'ticket_id')::uuid is not distinct from v_a and pg_temp.handoffs(v_a) = 1
    and e.actor_type is not distinct from 'ai' and e.actor_token_id is not distinct from v_ai and e.actor_user_id is null,
    'H05 sem ticket informado, o pedido entra na trilha do ticket em foco, assinado pelo token',
    j::text || ' | ' || coalesce(e.actor_type, '<null>'));
  insert into r values (
    e.metadata is not distinct from jsonb_build_object(
      'reason', 'Dúvida de cobrança fora do meu alcance', 'note_id', j ->> 'note_id'),
    'H06 a trilha guarda só o motivo (sem espaço nas pontas) e o id da nota; o resumo não entra nela',
    coalesce(e.metadata::text, '<null>'));
  select * into n from public.chat_messages m where m.id = (j ->> 'note_id')::uuid;
  insert into r values (
    n.content is not distinct from E'Dúvida de cobrança fora do meu alcance\n\nCliente recebeu dois boletos no mês.'
    and n.ticket_id is not distinct from v_a and n.type = 'note' and n.sender_type = 'ai'
    and n.sent_by_token_id is not distinct from v_ai,
    'H06b a nota leva o motivo e o resumo, e cai no ticket em foco', coalesce(n.content, '<sem nota>'));
  select * into v_row from public.tickets t where t.id = v_a;
  insert into r values (
    v_row.version is not distinct from v_ver and v_row.status = 'novo' and v_row.first_ai_response_at is null
    and pg_temp.handoffs(v_b) = 0,
    'H07 o handoff não mexe no ticket (versão, status, 1ª resposta da IA) nem grava no outro ticket da conversa',
    format('versão %s | status %s', v_row.version, v_row.status));

  j := public.conversation_handoff(v_c2, v_ai, 'De novo', 'Segunda chamada');
  insert into r values (
    j -> 'changed' = 'false'::jsonb and j -> 'ticket_id' = 'null'::jsonb and j -> 'note_id' = 'null'::jsonb
    and pg_temp.handoffs(v_a) = 1 and pg_temp.notes(v_c2) = 1,
    'H08 chamada repetida não grava outro evento nem outra nota', j::text || ' | ' || pg_temp.handoffs(v_a));
  j := public.conversation_handoff(v_c2, v_ai, 'Já está com a analista', null, v_b);
  insert into r values (
    j -> 'changed' = 'false'::jsonb and j -> 'ticket_id' = 'null'::jsonb
    and pg_temp.handoffs(v_b) = 0 and pg_temp.handoffs(v_a) = 1 and pg_temp.notes(v_c2) = 1,
    'H08b já humana com ticket válido informado: no-op, ticket_id nulo, nenhum evento', j::text);

  -- A analista devolve à IA pela tela; um novo handoff é outro pedido.
  update public.chat_conversations set status = 'bot' where id = v_c2;
  j := public.conversation_handoff(v_c2, v_ai, 'Agora é sobre o outro assunto', null, v_b);
  select c.active_ticket_id into v_act from public.chat_conversations c where c.id = v_c2;
  insert into r values (
    j -> 'changed' = 'true'::jsonb and (j ->> 'ticket_id')::uuid is not distinct from v_b
    and pg_temp.handoffs(v_b) = 1 and pg_temp.handoffs(v_a) = 1 and v_act is not distinct from v_a,
    'H09 ticket informado: o evento vai para ele, e o foco da conversa não muda', j::text);
  select * into n from public.chat_messages m where m.id = (j ->> 'note_id')::uuid;
  insert into r values (
    n.content is not distinct from 'Agora é sobre o outro assunto' and n.ticket_id is not distinct from v_b,
    'H10 sem resumo, a nota leva só o motivo; ela fica no ticket informado, junto do evento',
    coalesce(n.content, '<sem nota>') || ' | ' || coalesce(n.ticket_id::text, '<null>'));

  update public.chat_conversations set status = 'bot' where id = v_c2;
  j := public.conversation_handoff(v_c2, v_ai, 'Outro pedido, no ticket em foco', '   ');
  select * into n from public.chat_messages m where m.id = (j ->> 'note_id')::uuid;
  insert into r values (
    (j ->> 'ticket_id')::uuid is not distinct from v_a and pg_temp.handoffs(v_a) = 2 and pg_temp.notes(v_c2) = 3,
    'H10b novo pedido no MESMO ticket é outro evento e outra nota', j::text || ' | ' || pg_temp.handoffs(v_a));
  insert into r values (n.content is not distinct from 'Outro pedido, no ticket em foco',
    'H10c resumo só de espaços é resumo nenhum', coalesce(n.content, '<sem nota>'));

  -- Ticket informado numa conversa SEM foco: a nota não fica solta.
  v_f := (public.create_ticket(p_conversation_id => v_c7, p_title => 'Fora de foco', p_actor_token_id => v_ai,
                               p_set_active => false) -> 'ticket' ->> 'id')::uuid;
  j := public.conversation_handoff(v_c7, v_ai, 'Sobre o ticket sem foco', 'Resumo', v_f);
  select * into n from public.chat_messages m where m.id = (j ->> 'note_id')::uuid;
  select c.active_ticket_id into v_act from public.chat_conversations c where c.id = v_c7;
  insert into r values (
    (j ->> 'ticket_id')::uuid is not distinct from v_f and n.ticket_id is not distinct from v_f
    and pg_temp.handoffs(v_f) = 1 and v_act is null,
    'H10d ticket informado sem foco na conversa: a nota e o evento ficam nele, e o foco segue vazio',
    j::text || ' | ' || coalesce(n.ticket_id::text, '<null>'));

  -- Conversa arquivada ou removida volta para a caixa de entrada ---------------
  update public.chat_conversations set archived_at = now() - interval '1 hour' where id = v_c8;
  j := public.conversation_handoff(v_c8, v_ai, 'Cliente pediu um atendente');
  select * into v_conv from public.chat_conversations c where c.id = v_c8;
  insert into r values (
    j -> 'changed' = 'true'::jsonb and v_conv.status = 'human' and v_conv.archived_at is null
    and (select count(*) from public.contact_events ce
          where ce.entity_id = v_c8 and ce.event_type = 'conversation.unarchived') = 1,
    'H23 handoff de conversa arquivada a desarquiva (com o marco na trilha do contato)',
    coalesce(v_conv.archived_at::text, '<null>'));

  update public.chat_conversations set removed_at = now() - interval '1 hour', archived_at = now() - interval '2 hours'
   where id = v_c9;
  j := public.conversation_handoff(v_c9, v_ai, 'Cliente pediu um atendente');
  select * into v_conv from public.chat_conversations c where c.id = v_c9;
  insert into r values (
    v_conv.status = 'human' and v_conv.removed_at is null and v_conv.archived_at is null
    and (select count(*) from public.contact_events ce
          where ce.entity_id = v_c9 and ce.event_type = 'conversation.restored') = 1
    and (select count(*) from public.contact_events ce
          where ce.entity_id = v_c9 and ce.event_type = 'conversation.unarchived') = 1,
    'H24 handoff de conversa removida e arquivada a restaura e desarquiva, com os dois marcos',
    coalesce(v_conv.removed_at::text, '<null>') || ' | ' || coalesce(v_conv.archived_at::text, '<null>'));

  -- Já humana e arquivada: o no-op não mexe em nada (foi o time que arquivou).
  update public.chat_conversations set archived_at = now() - interval '1 hour' where id = v_c8;
  j := public.conversation_handoff(v_c8, v_ai, 'De novo');
  insert into r values (
    j -> 'changed' = 'false'::jsonb
    and (select c.archived_at is not null from public.chat_conversations c where c.id = v_c8),
    'H25 conversa já humana e arquivada: o no-op não a desarquiva', j::text);

  -- Conversa na caixa de entrada não ganha marco de desarquivar nem restaurar.
  insert into r values (
    (select count(*) from public.contact_events ce
      where ce.entity_id = v_c2 and ce.event_type in ('conversation.unarchived', 'conversation.restored')) = 0,
    'H26 handoff de conversa na caixa de entrada não grava marco de desarquivar nem restaurar', '');

  -- Token de integração (api) ------------------------------------------------
  v_c := (public.create_ticket(p_conversation_id => v_c3, p_title => 'Ticket da integração',
                               p_actor_token_id => v_api) -> 'ticket' ->> 'id')::uuid;
  -- Acentos e espaço nas pontas: o teto é em caracteres, medido depois do trim.
  j := public.conversation_handoff(v_c3, v_api, '  ' || repeat('ç', 500) || '  ', repeat('é', 4000));
  select ev.actor_type, ev.actor_token_id, ev.metadata into e from public.ticket_events ev
   where ev.ticket_id = v_c and ev.event_type = 'ticket.handoff_requested';
  select * into n from public.chat_messages m where m.id = (j ->> 'note_id')::uuid;
  insert into r values (
    j -> 'changed' = 'true'::jsonb and pg_temp.handoffs(v_c) = 1
    and e.actor_type is not distinct from 'api' and e.actor_token_id is not distinct from v_api
    and char_length(e.metadata ->> 'reason') is not distinct from 500,
    'H11 token de integração assina a trilha como api; motivo de 500 caracteres cabe',
    j::text || ' | ' || coalesce(e.actor_type, '<null>'));
  insert into r values (
    n.sender_type is not distinct from 'system' and n.sent_by_token_id is not distinct from v_api
    and char_length(n.content) is not distinct from 4502,
    'H11b a nota de uma integração sai como system; resumo de 4.000 caracteres cabe',
    coalesce(n.sender_type, '<sem nota>') || ' | ' || coalesce(char_length(n.content)::text, '<null>'));

  -- Recusas ------------------------------------------------------------------
  v_d := (public.create_ticket(p_conversation_id => v_c4, p_title => 'Ticket que será cancelado',
                               p_actor_token_id => v_ai) -> 'ticket' ->> 'id')::uuid;
  perform public.ticket_transition(v_d, 'cancelado', 1, v_ana, null, 'Aberto por engano');

  perform pg_temp.expect_fail('H12 ticket de outra conversa',
    format('select public.conversation_handoff(%L, %L, %L, null, %L)', v_c4, v_ai, 'Motivo', v_a),
    'P0001', 'TICKET_NOT_IN_CONVERSATION');
  perform pg_temp.expect_fail('H13 ticket que não existe',
    format('select public.conversation_handoff(%L, %L, %L, null, %L)', v_c4, v_ai, 'Motivo', gen_random_uuid()),
    'P0001', 'TICKET_NOT_IN_CONVERSATION');
  perform pg_temp.expect_fail('H14 ticket cancelado',
    format('select public.conversation_handoff(%L, %L, %L, null, %L)', v_c4, v_ai, 'Motivo', v_d),
    'P0001', 'TICKET_TERMINAL');
  perform pg_temp.expect_fail('H15 conversa que não existe',
    format('select public.conversation_handoff(%L, %L, %L)', gen_random_uuid(), v_ai, 'Motivo'),
    'P0001', 'CONVERSATION_NOT_FOUND');

  -- Ticket resolvido ainda não é terminal; fechado, é.
  v_e := (public.create_ticket(p_conversation_id => v_c6, p_title => 'Resolvido, depois fechado',
                               p_actor_token_id => v_ai) -> 'ticket' ->> 'id')::uuid;
  perform public.ticket_transition(v_e, 'em_atendimento', (select t.version from public.tickets t where t.id = v_e), v_ana);
  perform public.ticket_transition(v_e, 'resolvido', (select t.version from public.tickets t where t.id = v_e), v_ana);
  j := public.conversation_handoff(v_c6, v_ai, 'Cliente contestou a solução', null, v_e);
  insert into r values (
    j -> 'changed' = 'true'::jsonb and (j ->> 'ticket_id')::uuid is not distinct from v_e and pg_temp.handoffs(v_e) = 1,
    'H14b ticket resolvido (ainda não terminal) recebe o pedido', j::text);
  update public.chat_conversations set status = 'bot' where id = v_c6;
  perform public.ticket_transition(v_e, 'fechado', (select t.version from public.tickets t where t.id = v_e), v_ana);
  perform pg_temp.expect_fail('H14c ticket fechado',
    format('select public.conversation_handoff(%L, %L, %L, null, %L)', v_c6, v_ai, 'Motivo', v_e),
    'P0001', 'TICKET_TERMINAL');

  perform pg_temp.expect_fail('H16a token revogado',
    format('select public.conversation_handoff(%L, %L, %L)', v_c4, pg_temp.id('token_revoked'), 'Motivo'),
    'P0001', 'FORBIDDEN');
  perform pg_temp.expect_fail('H16b token vencido',
    format('select public.conversation_handoff(%L, %L, %L)', v_c4, pg_temp.id('token_expired'), 'Motivo'),
    'P0001', 'FORBIDDEN');
  perform pg_temp.expect_fail('H16c token que não existe',
    format('select public.conversation_handoff(%L, %L, %L)', v_c4, gen_random_uuid(), 'Motivo'),
    'P0001', 'FORBIDDEN');
  perform pg_temp.expect_fail('H16d sem token (o analista assume pela tela)',
    format('select public.conversation_handoff(%L, null, %L)', v_c4, 'Motivo'),
    'P0001', 'INVALID_ACTOR');
  perform pg_temp.expect_fail('H16e token revogado em conversa inexistente: o ator vem antes da conversa',
    format('select public.conversation_handoff(%L, %L, %L)', gen_random_uuid(), pg_temp.id('token_revoked'), 'Motivo'),
    'P0001', 'FORBIDDEN');
  perform pg_temp.expect_fail('H16f token revogado com motivo em branco: o ator vem antes da entrada',
    format('select public.conversation_handoff(%L, %L, %L)', v_c4, pg_temp.id('token_revoked'), '   '),
    'P0001', 'FORBIDDEN');

  perform pg_temp.expect_fail('H17a motivo em branco',
    format('select public.conversation_handoff(%L, %L, %L)', v_c4, v_ai, '   '), 'P0001', 'INVALID_HANDOFF');
  perform pg_temp.expect_fail('H17b motivo nulo',
    format('select public.conversation_handoff(%L, %L, null)', v_c4, v_ai), 'P0001', 'INVALID_HANDOFF');
  perform pg_temp.expect_fail('H17c motivo acima de 500 caracteres',
    format('select public.conversation_handoff(%L, %L, %L)', v_c4, v_ai, repeat('ç', 501)), 'P0001', 'INVALID_HANDOFF');
  perform pg_temp.expect_fail('H17d resumo acima de 4.000 caracteres',
    format('select public.conversation_handoff(%L, %L, %L, %L)', v_c4, v_ai, 'Motivo', repeat('é', 4001)),
    'P0001', 'INVALID_HANDOFF');
  perform pg_temp.expect_fail('H17e motivo em branco em conversa inexistente: a entrada vem antes da conversa',
    format('select public.conversation_handoff(%L, %L, %L)', gen_random_uuid(), v_ai, '   '),
    'P0001', 'INVALID_HANDOFF');

  -- Entrada errada é erro em qualquer estado, mesmo com a conversa já humana.
  perform pg_temp.expect_fail('H19 conversa já humana com ticket de outra conversa',
    format('select public.conversation_handoff(%L, %L, %L, null, %L)', v_c1, v_ai, 'Motivo', v_a),
    'P0001', 'TICKET_NOT_IN_CONVERSATION');
  perform public.conversation_handoff(v_c4, v_ai, 'Agora vale');
  perform pg_temp.expect_fail('H19b conversa já humana com ticket encerrado dela',
    format('select public.conversation_handoff(%L, %L, %L, null, %L)', v_c4, v_ai, 'Motivo', v_d),
    'P0001', 'TICKET_TERMINAL');

  -- Conversa resolvida não é da IA -------------------------------------------
  update public.chat_conversations set status = 'resolved' where id = v_c5;
  begin
    perform public.conversation_handoff(v_c5, v_ai, 'Motivo');
    insert into r values (false, 'H20 conversa resolvida: CONVERSATION_NOT_OWNED_BY_AI, com o status no HINT', 'passou');
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint, v_det = pg_exception_detail;
    insert into r values (
      sqlstate = 'P0001' and sqlerrm = 'CONVERSATION_NOT_OWNED_BY_AI'
      and v_h is not distinct from 'resolved' and coalesce(v_det, '') <> '',
      'H20 conversa resolvida: CONVERSATION_NOT_OWNED_BY_AI, com o status no HINT',
      sqlerrm || ' | ' || coalesce(v_h, '<null>'));
  end;

  -- A mensagem do cliente devolve a conversa à IA, e aí o handoff vale.
  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status)
  values (v_c5, 'inbound', 'contact', 'text', 'Voltei com outra dúvida', 'delivered');
  j := public.conversation_handoff(v_c5, v_ai, 'Cliente voltou e pediu um atendente');
  insert into r values (j -> 'changed' = 'true'::jsonb and pg_temp.conv_status(v_c5) = 'human',
    'H22 depois da mensagem do cliente (resolved → bot), o handoff vale', j::text);
end $$;

-- ---------------------------------------------------------------------------
-- P. Privilégios
-- ---------------------------------------------------------------------------
do $$
declare
  f constant text := 'public.conversation_handoff(uuid,uuid,text,text,uuid)';
  g constant text := 'public.guard_chat_message_token_author()';
begin
  insert into r values (
    pg_catalog.has_function_privilege('service_role', f, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', f, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE'),
    'P01 só o service_role executa conversation_handoff', '');

  insert into r values (
    pg_catalog.has_column_privilege('service_role', 'public.chat_messages', 'sent_by_token_id', 'INSERT')
    and pg_catalog.has_column_privilege('service_role', 'public.chat_messages', 'sent_by_token_id', 'SELECT')
    and not pg_catalog.has_column_privilege('service_role', 'public.chat_messages', 'sent_by_token_id', 'UPDATE'),
    'P02 o app grava e lê o token da mensagem, e não o troca', '');

  insert into r values (
    not pg_catalog.has_column_privilege('anon', 'public.chat_messages', 'sent_by_token_id', 'SELECT')
    and not pg_catalog.has_any_column_privilege('authenticated', 'public.chat_messages', 'INSERT, UPDATE'),
    'P03 anon não lê a coluna, e authenticated não escreve em chat_messages', '');

  insert into r values (
    exists (select 1 from pg_catalog.pg_indexes i
             where i.schemaname = 'public' and i.tablename = 'chat_messages'
               and i.indexname = 'chat_messages_sent_by_token_id_idx'
               and i.indexdef like '%(sent_by_token_id) WHERE (sent_by_token_id IS NOT NULL)'),
    'P04 a FK do token tem índice parcial', '');

  insert into r values (
    not pg_catalog.has_function_privilege('anon', g, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', g, 'EXECUTE'),
    'P05 a função do trigger de autoria não é executável por anon nem authenticated', '');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Como postgres: M15 (apagar token) e P06 (o que o operador logado lê)
-- ---------------------------------------------------------------------------
do $$
declare
  v_n   bigint;
  v_res text;
begin
  perform pg_temp.expect_fail('M15 token que escreveu mensagem não se apaga',
    format('delete from public.api_tokens where id = %L', pg_temp.id('token_msg')),
    '23503', 'chat_messages_sent_by_token_id_fkey');

  -- O SELECT de authenticated em chat_messages é de tabela (Realtime): a coluna
  -- nova vai junto, como ticket_id. É só o id; api_tokens segue fechada.
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"role":"authenticated","app_role":"member"}', true);
  select count(*) into v_n from public.chat_messages m where m.sent_by_token_id is not null;
  v_res := pg_temp.fails('select id from public.api_tokens limit 1', '42501');
  perform set_config('request.jwt.claims', '', true);
  reset role;
  insert into r values (v_n > 0 and v_res is null,
    'P06 o operador logado lê o id do token na mensagem, e não alcança api_tokens',
    format('%s mensagem(ns) com token | api_tokens: %s', v_n, coalesce(v_res, '42501')));
end $$;

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

-- `ok is not true`: asserção que dá NULL (um lado nulo na comparação) também é
-- falha. Com `not ok` ela passaria calada.
do $$
declare v_falhas text;
begin
  select string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes das conversas da IA falharam: %', v_falhas;
  end if;
  raise notice 'testes das conversas da IA: % caso(s), todos ok', (select count(*) from r);
end $$;

rollback;
