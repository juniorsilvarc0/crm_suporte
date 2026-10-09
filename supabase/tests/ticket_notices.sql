-- ============================================================================
-- Testes dos avisos ao cliente com claim/finalize (20261009150000 · Fase 6c-4).
-- Rodados por scripts/db-local-test.sh, em ROLLBACK. O setup roda como
-- postgres; as RPCs, como service_role (é quem a API v1 usa).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;
create temp table ids (ticket uuid, other_ticket uuid) on commit drop;
grant all on ids to service_role;

do $$
declare v_tech uuid; v_contact uuid; v_conv uuid; v_ticket uuid; v_other uuid;
begin
  insert into public.app_users (email, name, password_hash, role)
    values ('tecnico.aviso@local', 'Técnico Aviso', 'x', 'admin') returning id into v_tech;
  insert into public.contacts (phone, normalized_phone)
    values ('5511990002222', '11990002222') returning id into v_contact;
  insert into public.chat_conversations (contact_id, external_id)
    values (v_contact, '5511990002222') returning id into v_conv;
  v_ticket := (public.create_ticket(p_conversation_id => v_conv, p_title => 'Ticket do aviso',
    p_actor_user_id => v_tech) #>> '{ticket,id}')::uuid;
  v_other := (public.create_ticket(p_conversation_id => v_conv, p_title => 'Outro ticket',
    p_actor_user_id => v_tech) #>> '{ticket,id}')::uuid;
  insert into ids values (v_ticket, v_other);
end
$$;

set role service_role;

-- ── Reivindicar e fechar ─────────────────────────────────────────────────────
do $$
declare v_ticket uuid; v_other uuid; v jsonb; v_token uuid; v_again jsonb;
begin
  select ticket, other_ticket into v_ticket, v_other from ids;

  v := public.ticket_notice_claim(v_ticket, 'evt-1', null);
  v_token := (v ->> 'claim_token')::uuid;
  insert into r values ((v ->> 'claimed')::boolean and v_token is not null and (v ->> 'attempts')::int = 1,
    'passo livre: claimed com claim_token, 1ª tentativa', v::text);

  v_again := public.ticket_notice_claim(v_ticket, 'evt-1', null);
  insert into r values (not (v_again ->> 'claimed')::boolean and v_again ->> 'reason' = 'in_progress'
    and v_again ? 'lease_expires_at' and not v_again ? 'claim_token',
    'de novo com a lease valendo: in_progress, sem o claim_token', v_again::text);

  v_again := public.ticket_notice_claim(v_ticket, 'evt-2', null);
  insert into r values ((v_again ->> 'claimed')::boolean, 'outro passo do mesmo ticket é independente', v_again::text);
  v_again := public.ticket_notice_claim(v_other, 'evt-1', null);
  insert into r values ((v_again ->> 'claimed')::boolean, 'o mesmo passo em outro ticket é independente', v_again::text);

  v_again := public.ticket_notice_finalize(v_ticket, 'evt-1', gen_random_uuid(), 'sent');
  insert into r values (not (v_again ->> 'finalized')::boolean and v_again ->> 'reason' = 'claim_lost',
    'finalize com outro claim_token: claim_lost', v_again::text);

  v_again := public.ticket_notice_finalize(v_ticket, 'evt-1', v_token, 'sent');
  insert into r values ((v_again ->> 'finalized')::boolean and v_again ->> 'status' = 'sent',
    'finalize sent com o claim_token certo', v_again::text);
  v_again := public.ticket_notice_finalize(v_ticket, 'evt-1', v_token, 'sent');
  insert into r values ((v_again ->> 'finalized')::boolean and v_again ->> 'status' = 'sent',
    'repetir o finalize que já valeu não é erro', v_again::text);
  v_again := public.ticket_notice_finalize(v_ticket, 'evt-1', v_token, 'failed');
  insert into r values (not (v_again ->> 'finalized')::boolean and v_again ->> 'reason' = 'already_finalized',
    'enviado não vira falha', v_again::text);

  v_again := public.ticket_notice_claim(v_ticket, 'evt-1', null);
  insert into r values (not (v_again ->> 'claimed')::boolean and v_again ->> 'reason' = 'already_sent'
    and v_again ? 'finalized_at', 'enviado não se reivindica mais: already_sent', v_again::text);
end
$$;

-- ── Falha libera; o claim_token antigo não fecha o passo de outro ───────────
do $$
declare v_ticket uuid; v jsonb; v_first uuid; v_second uuid; v_again jsonb;
begin
  select ticket into v_ticket from ids;

  v := public.ticket_notice_claim(v_ticket, 'resolvido', null);
  v_first := (v ->> 'claim_token')::uuid;
  v_again := public.ticket_notice_finalize(v_ticket, 'resolvido', v_first, 'failed', '  WhatsApp fora do ar  ');
  insert into r values ((v_again ->> 'finalized')::boolean and v_again ->> 'status' = 'failed', 'finalize failed', v_again::text);

  v := public.ticket_notice_claim(v_ticket, 'resolvido', null);
  v_second := (v ->> 'claim_token')::uuid;
  insert into r values ((v ->> 'claimed')::boolean and (v ->> 'attempts')::int = 2 and v_second <> v_first,
    'depois de uma falha, reivindica na hora: 2ª tentativa, claim_token novo', v::text);

  v_again := public.ticket_notice_finalize(v_ticket, 'resolvido', v_first, 'sent');
  insert into r values (not (v_again ->> 'finalized')::boolean and v_again ->> 'reason' = 'claim_lost',
    'o claim_token da tentativa anterior não fecha a atual', v_again::text);
end
$$;
reset role;

-- O erro da falha fica guardado (sem espaços nas pontas) até o próximo finalize.
do $$
declare v_ticket uuid; v jsonb;
begin
  select ticket into v_ticket from ids;
  set local role service_role;
  v := public.ticket_notice_claim(v_ticket, 'erro', null);
  perform public.ticket_notice_finalize(v_ticket, 'erro', (v ->> 'claim_token')::uuid, 'failed', '  WhatsApp fora do ar  ');
  perform public.ticket_notice_claim(v_ticket, 'longo', null);
  reset role;
  insert into r values ((select n.last_error = 'WhatsApp fora do ar' from public.ticket_notices n
    where n.ticket_id = v_ticket and n.step = 'erro'), 'a falha guarda o motivo, aparado', null);
end
$$;

-- ── Lease vencida e limites da lease ─────────────────────────────────────────
do $$
declare v_ticket uuid; v jsonb; v_lease timestamptz;
begin
  select ticket into v_ticket from ids;
  -- Quem reivindicou 'evt-2' sumiu sem finalizar: a lease vence.
  update public.ticket_notices set lease_expires_at = pg_catalog.now() - interval '1 second'
   where ticket_id = v_ticket and step = 'evt-2';

  set local role service_role;
  v := public.ticket_notice_claim(v_ticket, 'evt-2', null);
  insert into r values ((v ->> 'claimed')::boolean and (v ->> 'attempts')::int = 2,
    'lease vencida sem finalize: reivindica de novo', v::text);

  v := public.ticket_notice_claim(v_ticket, 'curta', null, 5);
  v_lease := (v ->> 'lease_expires_at')::timestamptz;
  insert into r values (v_lease >= pg_catalog.now() + interval '29 seconds', 'lease mínima de 30 s', v::text);
  v := public.ticket_notice_claim(v_ticket, 'longa', null, 99999);
  v_lease := (v ->> 'lease_expires_at')::timestamptz;
  insert into r values (v_lease <= pg_catalog.now() + interval '900 seconds', 'lease máxima de 15 min', v::text);
  v := public.ticket_notice_claim(v_ticket, 'padrao', null);
  v_lease := (v ->> 'lease_expires_at')::timestamptz;
  insert into r values (v_lease between pg_catalog.now() + interval '119 seconds' and pg_catalog.now() + interval '121 seconds',
    'lease padrão de 2 min', v::text);
  reset role;
end
$$;

-- ── Erros ────────────────────────────────────────────────────────────────────
do $$
declare v_ticket uuid;
begin
  select ticket into v_ticket from ids;
  set local role service_role;
  begin
    perform public.ticket_notice_claim(v_ticket, 'com espaço', null);
    insert into r values (false, 'passo fora do formato: 22023', 'aceitou');
  exception when sqlstate '22023' then insert into r values (true, 'passo fora do formato: 22023', null); end;
  begin
    perform public.ticket_notice_claim(v_ticket, '-começa-com-traço', null);
    insert into r values (false, 'passo começa com letra ou número', 'aceitou');
  exception when sqlstate '22023' then insert into r values (true, 'passo começa com letra ou número', null); end;
  begin
    perform public.ticket_notice_claim(gen_random_uuid(), 'evt-1', null);
    insert into r values (false, 'ticket que não existe: P0002', 'aceitou');
  exception when sqlstate 'P0002' then insert into r values (true, 'ticket que não existe: P0002', null); end;
  begin
    perform public.ticket_notice_finalize(v_ticket, 'nunca', gen_random_uuid(), 'sent');
    insert into r values (false, 'finalize de passo nunca reivindicado: P0002', 'aceitou');
  exception when sqlstate 'P0002' then insert into r values (true, 'finalize de passo nunca reivindicado: P0002', null); end;
  begin
    perform public.ticket_notice_finalize(v_ticket, 'padrao', gen_random_uuid(), 'talvez');
    insert into r values (false, 'desfecho fora de sent/failed: 22023', 'aceitou');
  exception when sqlstate '22023' then insert into r values (true, 'desfecho fora de sent/failed: 22023', null); end;
  reset role;
end
$$;

-- ── Privilégios ──────────────────────────────────────────────────────────────
insert into r values (not pg_catalog.has_table_privilege('service_role', 'public.ticket_notices', 'select'),
  'service_role não lê a tabela direto (só pelas RPCs)', null);
insert into r values (not pg_catalog.has_table_privilege('service_role', 'public.ticket_notices', 'insert'),
  'service_role não escreve a tabela direto', null);
insert into r values (pg_catalog.has_function_privilege('service_role', 'public.ticket_notice_claim(uuid, text, uuid, integer)', 'execute'),
  'service_role executa o claim', null);
insert into r values (not pg_catalog.has_function_privilege('anon', 'public.ticket_notice_claim(uuid, text, uuid, integer)', 'execute'),
  'anon não executa o claim', null);
insert into r values (not pg_catalog.has_function_privilege('authenticated', 'public.ticket_notice_finalize(uuid, text, uuid, text, text)', 'execute'),
  'authenticated não executa o finalize', null);
insert into r values (not pg_catalog.has_table_privilege('authenticated', 'public.ticket_notices', 'select'),
  'authenticated não lê os avisos', null);

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes dos avisos ao cliente falharam: %', v_falhas;
  end if;
  raise notice 'testes dos avisos ao cliente: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
