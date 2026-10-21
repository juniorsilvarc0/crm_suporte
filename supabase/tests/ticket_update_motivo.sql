-- ============================================================================
-- Testes do motivo na alteração do ticket (20261021140000). Rodados por
-- scripts/db-local-test.sh, em ROLLBACK. O setup roda como postgres; a RPC,
-- como service_role (é quem a API v1 e a tela usam).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;
create temp table ids (ticket uuid, token uuid) on commit drop;
grant all on ids to service_role;

do $$
declare v_tech uuid; v_contact uuid; v_conv uuid; v_ticket uuid; v_token uuid;
begin
  insert into public.app_users (email, name, password_hash, role)
    values ('tecnico.motivo@local', 'Técnico Motivo', 'x', 'admin') returning id into v_tech;
  insert into public.contacts (phone, normalized_phone)
    values ('5511990004444', '11990004444') returning id into v_contact;
  insert into public.chat_conversations (contact_id, external_id)
    values (v_contact, '5511990004444') returning id into v_conv;
  v_ticket := (public.create_ticket(p_conversation_id => v_conv, p_title => '[Dúvida] Sangria lançada errada',
    p_actor_user_id => v_tech) #>> '{ticket,id}')::uuid;
  insert into public.api_tokens (name, token_hash, token_prefix, scopes, actor_type)
    values ('IA motivo', md5(random()::text) || md5(random()::text), 'crmsuporte_m1', '{tickets:write}', 'ai')
    returning id into v_token;
  insert into ids values (v_ticket, v_token);
end
$$;

set role service_role;

-- Atalhos: a versão atual e o último ticket.updated do ticket.
create function pg_temp.ver(p_ticket uuid) returns integer language sql as
  $f$ select t.version from public.tickets t where t.id = p_ticket $f$;
create function pg_temp.ultimo(p_ticket uuid) returns jsonb language sql as
  $f$ select e.metadata from public.ticket_events e
       where e.ticket_id = p_ticket and e.event_type = 'ticket.updated'
       order by e.occurred_at desc, e.seq desc limit 1 $f$;
create function pg_temp.quantos(p_ticket uuid) returns integer language sql as
  $f$ select pg_catalog.count(*)::integer from public.ticket_events e
       where e.ticket_id = p_ticket and e.event_type = 'ticket.updated' $f$;

-- ── Com motivo ───────────────────────────────────────────────────────────────
do $$
declare v_ticket uuid; v_token uuid; v jsonb; m jsonb;
begin
  select ticket, token into v_ticket, v_token from ids;

  v := public.ticket_update(v_ticket, pg_temp.ver(v_ticket),
    '{"title": "[Problema] Sistema travou ao fechar o caixa", "priority": "alta",
      "reason": "  Cliente relatou que o sistema travou depois da orientação  "}',
    p_actor_token_id => v_token);
  m := pg_temp.ultimo(v_ticket);
  insert into r values ((v ->> 'changed')::boolean
    and m #>> '{changes,title,from}' = '[Dúvida] Sangria lançada errada'
    and m #>> '{changes,title,to}' = '[Problema] Sistema travou ao fechar o caixa'
    and m #>> '{changes,priority,to}' = 'alta'
    and m ->> 'reason' = 'Cliente relatou que o sistema travou depois da orientação',
    'grava o motivo (aparado) junto das mudanças, no mesmo ticket.updated', m::text);
  insert into r values (not (select t.title from public.tickets t where t.id = v_ticket) ilike '%reason%',
    'o motivo não vira campo do ticket', null);
end
$$;

-- ── Sem motivo: como antes ───────────────────────────────────────────────────
do $$
declare v_ticket uuid; v_token uuid; m jsonb;
begin
  select ticket, token into v_ticket, v_token from ids;

  perform public.ticket_update(v_ticket, pg_temp.ver(v_ticket), '{"priority": "critica"}', p_actor_token_id => v_token);
  m := pg_temp.ultimo(v_ticket);
  insert into r values (m ? 'changes' and not m ? 'reason', 'sem reason: metadata só com changes (como antes)', m::text);

  perform public.ticket_update(v_ticket, pg_temp.ver(v_ticket), '{"priority": "media", "reason": "   "}', p_actor_token_id => v_token);
  m := pg_temp.ultimo(v_ticket);
  insert into r values (m #>> '{changes,priority,to}' = 'media' and not m ? 'reason', 'motivo em branco = sem motivo', m::text);

  perform public.ticket_update(v_ticket, pg_temp.ver(v_ticket), '{"priority": "baixa", "reason": null}', p_actor_token_id => v_token);
  m := pg_temp.ultimo(v_ticket);
  insert into r values (m #>> '{changes,priority,to}' = 'baixa' and not m ? 'reason', 'motivo nulo = sem motivo', m::text);
end
$$;

-- ── Nada mudou: o motivo sozinho não grava nada ──────────────────────────────
do $$
declare v_ticket uuid; v_token uuid; v jsonb; v_antes integer; v_versao integer;
begin
  select ticket, token into v_ticket, v_token from ids;
  v_antes := pg_temp.quantos(v_ticket);
  v_versao := pg_temp.ver(v_ticket);

  v := public.ticket_update(v_ticket, v_versao, '{"reason": "Só o motivo"}', p_actor_token_id => v_token);
  insert into r values (not (v ->> 'changed')::boolean and pg_temp.quantos(v_ticket) = v_antes
    and pg_temp.ver(v_ticket) = v_versao,
    'só o motivo: no-op, sem trilha e sem versão nova', v::text);

  v := public.ticket_update(v_ticket, v_versao, '{"priority": "baixa", "reason": "Mesmo valor"}', p_actor_token_id => v_token);
  insert into r values (not (v ->> 'changed')::boolean and pg_temp.quantos(v_ticket) = v_antes,
    'mesmo valor com motivo: no-op, sem trilha', v::text);
end
$$;

-- ── Erros ────────────────────────────────────────────────────────────────────
do $$
declare v_ticket uuid; v_token uuid; v_antes integer;
begin
  select ticket, token into v_ticket, v_token from ids;
  v_antes := pg_temp.quantos(v_ticket);
  begin
    perform public.ticket_update(v_ticket, pg_temp.ver(v_ticket),
      pg_catalog.jsonb_build_object('priority', 'alta', 'reason', repeat('x', 501)), p_actor_token_id => v_token);
    insert into r values (false, 'motivo com mais de 500: INVALID_PATCH', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_PATCH', 'motivo com mais de 500: INVALID_PATCH', sqlerrm);
  end;
  begin
    perform public.ticket_update(v_ticket, pg_temp.ver(v_ticket), '{"priority": "alta", "reason": 42}', p_actor_token_id => v_token);
    insert into r values (false, 'motivo que não é texto: INVALID_PATCH', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_PATCH', 'motivo que não é texto: INVALID_PATCH', sqlerrm);
  end;
  begin
    perform public.ticket_update(v_ticket, pg_temp.ver(v_ticket), '{"priority": "alta", "motivo": "x"}', p_actor_token_id => v_token);
    insert into r values (false, 'chave desconhecida continua INVALID_PATCH', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_PATCH', 'chave desconhecida continua INVALID_PATCH', sqlerrm);
  end;
  insert into r values ((select t.priority from public.tickets t where t.id = v_ticket) = 'baixa'
    and pg_temp.quantos(v_ticket) = v_antes, 'pedido recusado não altera o ticket nem a trilha', null);
end
$$;
reset role;

-- A mesma assinatura de sempre: nenhuma sobrecarga (a chamada ficaria ambígua).
insert into r values ((select pg_catalog.count(*) from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'ticket_update') = 1
  and pg_catalog.has_function_privilege('service_role', 'public.ticket_update(uuid, integer, jsonb, uuid, uuid)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.ticket_update(uuid, integer, jsonb, uuid, uuid)', 'execute'),
  'uma assinatura só, executável só pelo service_role', null);

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes do motivo na alteração falharam: %', v_falhas;
  end if;
  raise notice 'testes do motivo na alteração: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
