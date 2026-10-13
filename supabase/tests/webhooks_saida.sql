-- ============================================================================
-- Testes dos webhooks de saída (20261009130000 · Fase 6c-1). Rodados por
-- scripts/db-local-test.sh, em ROLLBACK. O setup (destinos, técnico, contato,
-- conversa) roda como postgres; os checks de privilégio, como service_role.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;
create temp table ids (tech uuid, conv uuid, ticket uuid, sub_all uuid, sub_status uuid, sub_off uuid) on commit drop;
grant all on ids to service_role;

-- Linhas `webhook` do outbox de um destino, por evento.
create or replace function pg_temp.webhooks(p_sub uuid, p_event text) returns integer language sql as $$
  select pg_catalog.count(*)::integer from public.event_outbox o
   where o.kind = 'webhook' and o.payload ->> 'subscription_id' = p_sub::text and o.payload ->> 'event' = p_event;
$$;

do $$
declare v_tech uuid; v_contact uuid; v_conv uuid; v_all uuid; v_status uuid; v_off uuid;
begin
  -- Destinos: um assina tudo o que testamos; um só status; um inativo.
  insert into public.webhook_subscriptions (name, url, events) values
    ('Tudo', 'https://exemplo.invalid/hook',
     array['ticket.created','ticket.updated','ticket.priority_changed','ticket.assigned','ticket.status_changed',
           'ticket.reopened','ticket.comment_added','ticket.attachment_added','ticket.sla_breached'])
    returning id into v_all;
  insert into public.webhook_subscriptions (name, url, events)
    values ('Só status', 'https://exemplo.invalid/status', array['ticket.status_changed'])
    returning id into v_status;
  insert into public.webhook_subscriptions (name, url, events, is_active)
    values ('Desligado', 'https://exemplo.invalid/off', array['ticket.created','ticket.status_changed'], false)
    returning id into v_off;

  insert into public.app_users (email, name, password_hash, role)
    values ('tecnico.webhook@local', 'Técnico Webhook', 'x', 'admin') returning id into v_tech;
  insert into public.contacts (phone, normalized_phone)
    values ('5511990001111', '11990001111') returning id into v_contact;
  insert into public.chat_conversations (contact_id, external_id)
    values (v_contact, '5511990001111') returning id into v_conv;
  insert into ids values (v_tech, v_conv, null, v_all, v_status, v_off);
end
$$;

-- ── Fan-out a partir das mudanças do ticket ──────────────────────────────────
do $$
declare v_tech uuid; v_conv uuid; v_all uuid; v_status uuid; v_off uuid; v_ticket uuid; v_payload jsonb;
begin
  select tech, conv, sub_all, sub_status, sub_off into v_tech, v_conv, v_all, v_status, v_off from ids;

  v_ticket := (public.create_ticket(p_conversation_id => v_conv, p_title => 'Ticket do webhook',
    p_actor_user_id => v_tech) #>> '{ticket,id}')::uuid;
  update ids set ticket = v_ticket;

  insert into r values (pg_temp.webhooks(v_all, 'ticket.created') = 1, 'ticket.created enfileira para quem assinou', null);
  insert into r values (pg_temp.webhooks(v_status, 'ticket.created') = 0, 'quem não assinou o evento não recebe', null);
  insert into r values (pg_temp.webhooks(v_off, 'ticket.created') = 0, 'destino desligado não recebe', null);

  select o.payload into v_payload from public.event_outbox o
   where o.kind = 'webhook' and o.payload ->> 'subscription_id' = v_all::text and o.payload ->> 'event' = 'ticket.created';
  insert into r values (
    v_payload ->> 'event_id' is not null and v_payload -> 'data' ->> 'ticket_id' = v_ticket::text
      and v_payload ? 'occurred_at',
    'o corpo leva event_id, occurred_at e o ticket', v_payload::text);

  -- Status: novo → em atendimento → resolvido → em atendimento (reaberto).
  perform public.ticket_transition(v_ticket, 'em_atendimento', 1, v_tech);
  perform public.ticket_transition(v_ticket, 'resolvido', 2, v_tech);
  perform public.ticket_transition(v_ticket, 'em_atendimento', 3, v_tech);
  insert into r values (pg_temp.webhooks(v_all, 'ticket.status_changed') = 3, 'cada mudança de status enfileira', null);
  insert into r values (pg_temp.webhooks(v_status, 'ticket.status_changed') = 3, 'o destino de status recebe os três', null);
  insert into r values (pg_temp.webhooks(v_all, 'ticket.reopened') = 1, 'sair de resolvido para atendimento = reaberto', null);

  -- Alteração de prioridade: updated + priority_changed.
  perform public.ticket_update(v_ticket, 4, '{"priority":"alta"}'::jsonb, v_tech);
  insert into r values (pg_temp.webhooks(v_all, 'ticket.updated') = 1, 'ticket.updated enfileira', null);
  insert into r values (pg_temp.webhooks(v_all, 'ticket.priority_changed') = 1, 'prioridade também sai como priority_changed', null);

  -- Comentário: sem o texto.
  insert into public.ticket_comments (ticket_id, author_user_id, body) values (v_ticket, v_tech, 'texto interno secreto');
  select o.payload into v_payload from public.event_outbox o
   where o.kind = 'webhook' and o.payload ->> 'subscription_id' = v_all::text and o.payload ->> 'event' = 'ticket.comment_added';
  insert into r values (v_payload is not null and v_payload::text not like '%secreto%',
    'comentário enfileira SEM o texto', coalesce(v_payload::text, 'nada'));

  -- SLA estourado: uma vez por prazo, mesmo que o carimbo seja "regravado".
  update public.tickets set first_response_breached_at = pg_catalog.now() where id = v_ticket;
  update public.tickets set title = title where id = v_ticket;
  insert into r values (pg_temp.webhooks(v_all, 'ticket.sla_breached') = 1, 'sla_breached da 1ª resposta sai uma vez', null);
  update public.tickets set resolution_breached_at = pg_catalog.now() where id = v_ticket;
  insert into r values (pg_temp.webhooks(v_all, 'ticket.sla_breached') = 2, 'o prazo de solução é outro evento', null);

  -- Repetir o mesmo evento (mesmo id) não duplica a entrega.
  perform public.webhook_emit('ticket.created', (v_payload ->> 'event_id'), pg_catalog.now(), '{}'::jsonb);
  perform public.webhook_emit('ticket.created', (v_payload ->> 'event_id'), pg_catalog.now(), '{}'::jsonb);
  insert into r values (
    (select pg_catalog.count(*) from public.event_outbox o
      where o.kind = 'webhook' and o.event_key = (v_payload ->> 'event_id') || ':' || v_all::text) = 1,
    'o mesmo evento não entra duas vezes para o mesmo destino', null);
end
$$;

-- ── Reenvio manual ───────────────────────────────────────────────────────────
do $$
declare v_id uuid; v_relay uuid;
begin
  select o.id into v_id from public.event_outbox o where o.kind = 'webhook' limit 1;
  update public.event_outbox set status = 'dead_letter', attempts = 8, last_error = 'HTTP 500' where id = v_id;
  insert into r values (public.outbox_requeue(v_id), 'dead_letter de webhook volta para a fila', null);
  insert into r values (
    (select status = 'pending' and attempts = 0 and last_error is null from public.event_outbox where id = v_id),
    'o reenvio zera tentativas e erro', null);
  insert into r values (not public.outbox_requeue(v_id), 'o que não está em dead_letter não é reenfileirado', null);

  insert into public.event_outbox (kind, event_key, status) values ('relay', 'teste-relay-dead', 'dead_letter') returning id into v_relay;
  insert into r values (not public.outbox_requeue(v_relay), 'relay não se reenfileira (janela de 2 min)', null);
end
$$;

-- 20261009160000: o reenvio recomeça o prazo de 3 dias. Sem isso, a entrega que
-- morreu pelo prazo voltava à fila e o claim seguinte a matava de novo.
do $$
declare v_old uuid; v_claimed uuid; v_status text;
begin
  insert into public.event_outbox (kind, event_key, status, attempts, created_at, last_error)
    values ('webhook', 'teste-velha:dest', 'dead_letter', 3, pg_catalog.now() - interval '4 days', 'prazo')
    returning id into v_old;
  insert into r values (public.outbox_requeue(v_old), 'entrega velha (4 dias) volta para a fila', null);
  insert into r values (
    (select created_at > pg_catalog.now() - interval '1 minute' from public.event_outbox where id = v_old),
    'o reenvio recomeça o prazo (created_at = agora)', null);

  select c.id into v_claimed
    from public.outbox_claim('teste-reenvio', 'webhook', 100, 8, 3 * 24 * 60 * 60) c
   where c.id = v_old;
  select status into v_status from public.event_outbox where id = v_old;
  insert into r values (v_claimed is not null and v_status = 'processing',
    'a entrega reenviada é reivindicada, e não morta de novo pelo prazo', v_status);
end
$$;

-- ── Segredo no Vault ─────────────────────────────────────────────────────────
set role service_role;
do $$
declare v_all uuid; v_secret_id uuid;
begin
  select sub_all into v_all from ids;

  insert into r values (public.set_webhook_subscription_secret(v_all, pg_catalog.repeat('s', 40)), 'grava o segredo pela RPC', null);
  insert into r values (public.get_webhook_subscription_secret(v_all) = pg_catalog.repeat('s', 40), 'lê o segredo pela RPC', null);

  begin
    perform public.set_webhook_subscription_secret(v_all, 'curto');
    insert into r values (false, 'segredo curto recusado', 'aceitou');
  exception when invalid_parameter_value then insert into r values (true, 'segredo curto recusado', 'ok'); end;

  begin
    update public.webhook_subscriptions set secret_id = gen_random_uuid() where id = v_all;
    insert into r values (false, 'service_role NÃO troca o secret_id direto', 'trocou');
  exception when insufficient_privilege then insert into r values (true, 'service_role NÃO troca o secret_id direto', 'ok'); end;

  update public.webhook_subscriptions set is_active = false, name = 'Tudo (pausado)' where id = v_all;
  insert into r values (true, 'service_role pausa e renomeia o destino', null);

  begin
    insert into public.webhook_subscriptions (name, url, events) values ('Ruim', 'ftp://x', array['ticket.created']);
    insert into r values (false, 'URL que não é http(s) recusada', 'aceitou');
  exception when check_violation then insert into r values (true, 'URL que não é http(s) recusada', 'ok'); end;

  begin
    insert into public.webhook_subscriptions (name, url, events) values ('Ruim', 'https://x', array['Ticket Criado']);
    insert into r values (false, 'evento fora do formato recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'evento fora do formato recusado', 'ok'); end;

  begin
    insert into public.webhook_subscriptions (name, url, events) values ('Ruim', 'https://x', array[]::text[]);
    insert into r values (false, 'destino sem evento recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'destino sem evento recusado', 'ok'); end;

  begin
    perform public.webhook_emit('ticket.created', 'x', pg_catalog.now(), '{}'::jsonb);
    insert into r values (true, 'service_role executa o fan-out (o app emite webhook.ping)', null);
  exception when insufficient_privilege then insert into r values (false, 'service_role executa o fan-out (o app emite webhook.ping)', 'negado'); end;

  select w.secret_id into v_secret_id from public.webhook_subscriptions w where w.id = v_all;
  delete from public.webhook_subscriptions where id = v_all;
  reset role;
  insert into r values (not exists (select 1 from vault.secrets s where s.id = v_secret_id),
    'apagar o destino apaga o segredo do Vault', null);
end
$$;
reset role;

-- anon e authenticated não alcançam nada disto.
insert into r values (not pg_catalog.has_table_privilege('anon', 'public.webhook_subscriptions', 'select'), 'anon não lê os destinos', null);
insert into r values (not pg_catalog.has_table_privilege('authenticated', 'public.webhook_subscriptions', 'select'), 'authenticated não lê os destinos', null);
insert into r values (not pg_catalog.has_function_privilege('anon', 'public.webhook_emit(text, text, timestamptz, jsonb)', 'execute'), 'anon não executa o fan-out', null);
insert into r values (not pg_catalog.has_function_privilege('authenticated', 'public.get_webhook_subscription_secret(uuid)', 'execute'), 'authenticated não lê segredo', null);
insert into r values (not pg_catalog.has_function_privilege('authenticated', 'public.outbox_requeue(uuid)', 'execute'), 'authenticated não reenvia', null);
-- 20261009140000: o servidor lê as entregas, mas não a lease (não finaliza a alheia).
insert into r values (pg_catalog.has_column_privilege('service_role', 'public.event_outbox', 'last_error', 'select'), 'service_role lê o erro da entrega', null);
insert into r values (not pg_catalog.has_column_privilege('service_role', 'public.event_outbox', 'lease_token', 'select'), 'service_role NÃO lê a lease', null);
insert into r values (not pg_catalog.has_table_privilege('service_role', 'public.event_outbox', 'update'), 'service_role NÃO altera a fila direto', null);

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes dos webhooks de saída falharam: %', v_falhas;
  end if;
  raise notice 'testes dos webhooks de saída: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
