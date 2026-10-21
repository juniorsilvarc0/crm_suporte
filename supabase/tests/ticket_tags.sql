-- ============================================================================
-- Testes das etiquetas do ticket (20261021120000). Rodados por
-- scripts/db-local-test.sh, em ROLLBACK. O setup roda como postgres; a RPC,
-- como service_role (é quem a API v1 e a tela usam).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;
create temp table ids (ticket uuid, other_ticket uuid, tech uuid, token uuid, revoked uuid) on commit drop;
grant all on ids to service_role;

do $$
declare v_tech uuid; v_contact uuid; v_conv uuid; v_ticket uuid; v_other uuid; v_token uuid; v_revoked uuid;
begin
  insert into public.app_users (email, name, password_hash, role)
    values ('tecnico.etiqueta@local', 'Técnico Etiqueta', 'x', 'admin') returning id into v_tech;
  insert into public.contacts (phone, normalized_phone)
    values ('5511990003333', '11990003333') returning id into v_contact;
  insert into public.chat_conversations (contact_id, external_id)
    values (v_contact, '5511990003333') returning id into v_conv;
  v_ticket := (public.create_ticket(p_conversation_id => v_conv, p_title => 'Ticket etiquetado',
    p_actor_user_id => v_tech) #>> '{ticket,id}')::uuid;
  v_other := (public.create_ticket(p_conversation_id => v_conv, p_title => 'Outro ticket',
    p_actor_user_id => v_tech) #>> '{ticket,id}')::uuid;
  insert into public.api_tokens (name, token_hash, token_prefix, scopes, actor_type)
    values ('IA etiquetas', md5(random()::text) || md5(random()::text), 'crmsuporte_t1', '{tickets:write}', 'ai')
    returning id into v_token;
  insert into public.api_tokens (name, token_hash, token_prefix, scopes, actor_type, revoked_at)
    values ('Revogado', md5(random()::text) || md5(random()::text), 'crmsuporte_t2', '{tickets:write}', 'ai', now())
    returning id into v_revoked;
  -- Uma etiqueta que já existe no vocabulário (criada pela tela, com cor).
  insert into public.tags (name, color) values ('Cliente VIP', 'amber');
  insert into ids values (v_ticket, v_other, v_tech, v_token, v_revoked);
end
$$;

set role service_role;

-- ── Acrescentar ──────────────────────────────────────────────────────────────
do $$
declare v_ticket uuid; v_token uuid; v jsonb; v_events int; v_tags int;
begin
  select ticket, token into v_ticket, v_token from ids;
  select pg_catalog.count(*) into v_tags from public.tags;

  v := public.ticket_add_tags(v_ticket, array['duvida', '  caixa ', 'DUVIDA', 'cliente vip'],
    p_actor_token_id => v_token);
  insert into r values (v -> 'added' = '["duvida", "caixa", "Cliente VIP"]'::jsonb,
    'acrescenta, apara, conta o repetido sem caixa uma vez e usa o nome da etiqueta existente', v::text);
  insert into r values (pg_catalog.jsonb_array_length(v -> 'tags') = 3
    and v #>> '{tags,0,name}' = 'caixa' and v #>> '{tags,1,name}' = 'Cliente VIP'
    and v #>> '{tags,1,color}' = 'amber' and v #>> '{tags,2,color}' = 'slate',
    'devolve todas as do ticket, pelo nome, com a cor (a nova nasce slate)', v::text);
  insert into r values ((select pg_catalog.count(*) from public.tags) = v_tags + 2,
    'só as duas que não existiam entram no vocabulário', null);

  select pg_catalog.count(*) into v_events from public.ticket_events e
   where e.ticket_id = v_ticket and e.event_type = 'ticket.tags_added'
     and e.actor_type = 'ai' and e.actor_token_id = v_token
     and e.metadata -> 'tags' = '["duvida", "caixa", "Cliente VIP"]'::jsonb;
  insert into r values (v_events = 1, 'a trilha guarda quem marcou e o que entrou (ticket.tags_added)', v_events::text);

  v := public.ticket_add_tags(v_ticket, array['caixa', 'Duvida'], p_actor_token_id => v_token);
  select pg_catalog.count(*) into v_events from public.ticket_events e
   where e.ticket_id = v_ticket and e.event_type = 'ticket.tags_added';
  insert into r values (v -> 'added' = '[]'::jsonb and pg_catalog.jsonb_array_length(v -> 'tags') = 3 and v_events = 1,
    'repetir é seguro: nada entra de novo e não gera trilha', v::text);

  v := public.ticket_add_tags(v_ticket, array['resolvido-pela-ia'], p_actor_token_id => v_token);
  insert into r values (v -> 'added' = '["resolvido-pela-ia"]'::jsonb and pg_catalog.jsonb_array_length(v -> 'tags') = 4,
    'acrescentar depois soma às que já estavam', v::text);
end
$$;

-- Usuário como ator; outro ticket é independente; ticket resolvido também recebe.
do $$
declare v_ticket uuid; v_other uuid; v_tech uuid; v jsonb; v_version int;
begin
  select ticket, other_ticket, tech into v_ticket, v_other, v_tech from ids;

  v := public.ticket_add_tags(v_other, array['duvida'], p_actor_user_id => v_tech);
  insert into r values (v -> 'added' = '["duvida"]'::jsonb and pg_catalog.jsonb_array_length(v -> 'tags') = 1,
    'a mesma etiqueta em outro ticket é independente', v::text);
  insert into r values (exists (select 1 from public.ticket_events e where e.ticket_id = v_other
    and e.event_type = 'ticket.tags_added' and e.actor_type = 'agent' and e.actor_user_id = v_tech),
    'usuário como ator: trilha com actor_type agent', null);

  select t.version into v_version from public.tickets t where t.id = v_ticket;
  perform public.ticket_transition(v_ticket, 'em_atendimento', v_version, p_actor_user_id => v_tech);
  select t.version into v_version from public.tickets t where t.id = v_ticket;
  perform public.ticket_transition(v_ticket, 'resolvido', v_version, p_actor_user_id => v_tech);
  select t.version into v_version from public.tickets t where t.id = v_ticket;
  v := public.ticket_add_tags(v_ticket, array['sem-confirmacao'], p_actor_user_id => v_tech);
  insert into r values (v -> 'added' = '["sem-confirmacao"]'::jsonb
    and (select t.version from public.tickets t where t.id = v_ticket) = v_version,
    'ticket resolvido recebe etiqueta, e a versão do ticket não muda', v::text);
end
$$;

-- ── Erros ────────────────────────────────────────────────────────────────────
do $$
declare v_ticket uuid; v_token uuid; v_revoked uuid; v_tech uuid;
begin
  select ticket, token, revoked, tech into v_ticket, v_token, v_revoked, v_tech from ids;
  begin
    perform public.ticket_add_tags(gen_random_uuid(), array['duvida'], p_actor_token_id => v_token);
    insert into r values (false, 'ticket que não existe: TICKET_NOT_FOUND', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'TICKET_NOT_FOUND', 'ticket que não existe: TICKET_NOT_FOUND', sqlerrm);
  end;
  begin
    perform public.ticket_add_tags(v_ticket, array[]::text[], p_actor_token_id => v_token);
    insert into r values (false, 'lista vazia: INVALID_TAGS', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_TAGS', 'lista vazia: INVALID_TAGS', sqlerrm);
  end;
  begin
    perform public.ticket_add_tags(v_ticket, array(select 'e' || g from generate_series(1, 21) g),
      p_actor_token_id => v_token);
    insert into r values (false, 'mais de 20: INVALID_TAGS', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_TAGS', 'mais de 20: INVALID_TAGS', sqlerrm);
  end;
  begin
    perform public.ticket_add_tags(v_ticket, array['ok', '   '], p_actor_token_id => v_token);
    insert into r values (false, 'nome em branco: INVALID_TAGS', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_TAGS', 'nome em branco: INVALID_TAGS', sqlerrm);
  end;
  begin
    perform public.ticket_add_tags(v_ticket, array[repeat('x', 31)], p_actor_token_id => v_token);
    insert into r values (false, 'nome com mais de 30: INVALID_TAGS', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_TAGS', 'nome com mais de 30: INVALID_TAGS', sqlerrm);
  end;
  begin
    perform public.ticket_add_tags(v_ticket, array['linha' || chr(10) || 'quebrada'], p_actor_token_id => v_token);
    insert into r values (false, 'caractere de controle: INVALID_TAGS', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_TAGS', 'caractere de controle: INVALID_TAGS', sqlerrm);
  end;
  begin
    perform public.ticket_add_tags(v_ticket, array['duvida'], p_actor_token_id => v_revoked);
    insert into r values (false, 'token revogado: FORBIDDEN', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'FORBIDDEN', 'token revogado: FORBIDDEN', sqlerrm);
  end;
  begin
    perform public.ticket_add_tags(v_ticket, array['duvida'], v_tech, v_token);
    insert into r values (false, 'dois atores: INVALID_ACTOR', 'aceitou');
  exception when others then
    insert into r values (sqlerrm = 'INVALID_ACTOR', 'dois atores: INVALID_ACTOR', sqlerrm);
  end;
  insert into r values (not exists (select 1 from public.tags g where g.name in ('ok', 'e1')),
    'pedido recusado não deixa etiqueta nova para trás', null);
end
$$;
reset role;

-- ── Etiqueta apagada no cadastro sai do ticket; a trilha fica ────────────────
do $$
declare v_ticket uuid;
begin
  select ticket into v_ticket from ids;
  delete from public.tags where name = 'caixa';
  insert into r values (not exists (select 1 from public.ticket_tags tt join public.tags g on g.id = tt.tag_id
      where tt.ticket_id = v_ticket and g.name = 'caixa')
    and exists (select 1 from public.ticket_events e where e.ticket_id = v_ticket
      and e.event_type = 'ticket.tags_added' and e.metadata -> 'tags' ? 'caixa'),
    'apagar a etiqueta tira do ticket e mantém o nome na trilha', null);
end
$$;

-- ── Privilégios ──────────────────────────────────────────────────────────────
insert into r values (pg_catalog.has_table_privilege('service_role', 'public.ticket_tags', 'select'),
  'service_role lê as etiquetas do ticket (detalhe e métricas)', null);
insert into r values (not pg_catalog.has_table_privilege('service_role', 'public.ticket_tags', 'insert')
  and not pg_catalog.has_table_privilege('service_role', 'public.ticket_tags', 'delete')
  and not pg_catalog.has_table_privilege('service_role', 'public.ticket_tags', 'update'),
  'service_role não escreve direto (só pela RPC)', null);
insert into r values (pg_catalog.has_function_privilege('service_role', 'public.ticket_add_tags(uuid, text[], uuid, uuid)', 'execute'),
  'service_role executa a RPC', null);
insert into r values (not pg_catalog.has_function_privilege('anon', 'public.ticket_add_tags(uuid, text[], uuid, uuid)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.ticket_add_tags(uuid, text[], uuid, uuid)', 'execute'),
  'anon e authenticated não executam a RPC', null);
insert into r values (not pg_catalog.has_table_privilege('authenticated', 'public.ticket_tags', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.ticket_tags', 'select'),
  'anon e authenticated não leem as etiquetas do ticket', null);

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes das etiquetas do ticket falharam: %', v_falhas;
  end if;
  raise notice 'testes das etiquetas do ticket: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
