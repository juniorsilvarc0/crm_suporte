-- ============================================================================
-- Fase 5 · PR 3 — fundação da API v1 no banco (docs/PLANO-FASE-5.md).
--
-- 1. api_tokens.actor_type (ai|api): quem o token representa. O CRM grava a
--    autoria (ticket_events/ticket_status_history) e a origem do ticket por
--    ele, não pelos escopos (decisão D10 do dono, 2026-09-29).
-- 2. require_ticket_actor devolve o tipo do token, e create_ticket passa a
--    tirar a origem dele: um p_source que o contradiga é INVALID_SOURCE.
-- 3. api_idempotency_keys + RPCs begin/finish/release/purge: o Idempotency-Key
--    da v1 (D6). Mesma chave, mesmo caminho e mesmo corpo repetem a resposta;
--    qualquer diferença é "reused"; requisição em curso é "in_progress"; lease
--    vencida (quem a tinha morreu) é retomada. Cada tentativa ganha um
--    attempt_id, e só ela conclui ou libera a chave. Guarda só 2xx e 422, 24 h.
-- 4. purge_integration_logs: retenção de 90 dias (D9), que é também o piso.
--    Quem executa é o worker da Fase 6; até lá, à mão.
--
-- Nenhuma tabela nova é alcançável fora das RPCs: api_idempotency_keys não
-- tem grant nem para o service_role. Idempotente; depende de 20260925120900.
-- ============================================================================

do $$
begin
  if to_regclass('public.tickets') is null or to_regclass('public.api_tokens') is null then
    raise exception 'API V1: aplique 20260925120900_tickets antes';
  end if;
end
$$;

-- ============================================================================
-- 1. api_tokens.actor_type
-- ============================================================================
alter table public.api_tokens
  add column if not exists actor_type text not null default 'api';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.api_tokens'::regclass and conname = 'api_tokens_actor_type_check'
  ) then
    alter table public.api_tokens
      add constraint api_tokens_actor_type_check check (actor_type in ('ai', 'api'));
  end if;
end
$$;

comment on column public.api_tokens.actor_type is
  'Quem o token representa: ai (agente de IA) ou api (integração). Vira a origem do ticket e a autoria nos eventos.';

-- Editável como os escopos (a tela de tokens, PR 5). O INSERT de tabela já
-- cobre a coluna nova.
grant update (actor_type) on table public.api_tokens to service_role;

-- ============================================================================
-- 2. require_ticket_actor devolve ai|api para token; create_ticket usa isso
-- ============================================================================
create or replace function public.require_ticket_actor(p_user_id uuid, p_token_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_type text;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('public.app_users:gestao', 0)
  );

  if pg_catalog.num_nonnulls(p_user_id, p_token_id) <> 1 then
    raise exception 'INVALID_ACTOR'
      using detail = 'Informe exatamente um ator: usuário ou token.';
  end if;

  if p_user_id is not null then
    if not exists (
      select 1 from public.app_users u where u.id = p_user_id and u.is_active
    ) then
      raise exception 'FORBIDDEN' using detail = 'Usuário inativo ou inexistente.';
    end if;
    return 'agent';
  end if;

  select t.actor_type into v_type
    from public.api_tokens t
   where t.id = p_token_id
     and t.revoked_at is null
     and (t.expires_at is null or t.expires_at > pg_catalog.now());
  if not found then
    raise exception 'FORBIDDEN' using detail = 'Token revogado, vencido ou inexistente.';
  end if;
  return v_type;
end;
$$;

-- create_ticket: corpo de 20260925120900 com UMA troca, no ramo do token
-- (a origem vem de v_actor). O resto é idêntico, linha a linha.
create or replace function public.create_ticket(
  p_conversation_id     uuid,
  p_title               text,
  p_priority            text    default 'media',
  p_actor_user_id       uuid    default null,
  p_actor_token_id      uuid    default null,
  p_description         text    default null,
  p_product_id          uuid    default null,
  p_category_id         uuid    default null,
  p_assigned_to_user_id uuid    default null,
  p_idempotency_key     text    default null,
  p_set_active          boolean default true,
  p_take_over           boolean default false,
  p_status              text    default 'novo',
  p_source              text    default null,
  p_external_id         text    default null,
  p_ai_triage           jsonb   default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     text;
  v_source    text;
  v_take      boolean := coalesce(p_take_over, false);
  v_conv      public.chat_conversations%rowtype;
  v_existing  public.tickets%rowtype;
  v_policy    public.sla_policies%rowtype;
  v_customer  uuid;
  v_t         public.tickets%rowtype;
  v_now       timestamptz := pg_catalog.now();
  v_since     timestamptz;
  v_linked    integer := 0;
  v_human     boolean := false;
  v_ai        boolean := false;
  v_changed   boolean := false;
begin
  v_actor := public.require_ticket_actor(p_actor_user_id, p_actor_token_id);
  if v_actor = 'agent' then
    if (p_source is not null and p_source <> 'agent')
       or p_external_id is not null or p_ai_triage is not null then
      raise exception 'INVALID_SOURCE'
        using detail = 'Ticket aberto na tela é do analista; external_id e ai_triage são da integração.';
    end if;
    v_source := 'agent';
  else
    if v_take then
      raise exception 'FORBIDDEN' using detail = 'Só um analista assume o atendimento.';
    end if;
    -- A origem é o tipo do TOKEN (require_ticket_actor devolve ai|api):
    -- p_source só pode confirmá-lo. Um token 'api' não abre ticket como IA.
    if p_source is not null and p_source <> v_actor then
      raise exception 'INVALID_SOURCE'
        using detail = 'A origem do ticket é o tipo do token (ai ou api).';
    end if;
    v_source := v_actor;
  end if;
  if coalesce(p_status, 'novo') not in ('novo', 'em_triagem') then
    raise exception 'INVALID_INITIAL_STATUS' using detail = 'Ticket nasce em novo ou em_triagem.';
  end if;
  if v_take and p_assigned_to_user_id is not null and p_assigned_to_user_id <> p_actor_user_id then
    raise exception 'INVALID_ASSIGNEE' using detail = 'Assumir já atribui o ticket a quem abre.';
  end if;

  -- Trava 1: a conversa, FOR UPDATE (espera as mensagens em voo; §8.6) e
  -- serializa aberturas simultâneas na mesma conversa.
  select * into v_conv from public.chat_conversations c
   where c.id = p_conversation_id
     for update;
  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;

  -- Idempotência POR ATOR: a chave (ou o external_id) de um integrador nunca
  -- devolve o ticket de outro.
  if p_idempotency_key is not null or (p_external_id is not null and p_actor_token_id is not null) then
    select * into v_existing from public.tickets t
     where (p_idempotency_key is not null
            and t.idempotency_key = p_idempotency_key
            and (t.created_by_user_id = p_actor_user_id or t.created_by_token_id = p_actor_token_id))
        or (p_external_id is not null
            and t.created_by_token_id = p_actor_token_id
            and t.external_id = p_external_id)
     limit 1;
    if found then
      if v_existing.conversation_id <> p_conversation_id then
        raise exception 'IDEMPOTENCY_KEY_REUSED';
      end if;
      return pg_catalog.jsonb_build_object(
        'ticket', public.ticket_summary(v_existing.id), 'created', false, 'linked_messages', 0,
        'conversation_changed', false, 'conversation_external_id', v_conv.external_id);
    end if;
  end if;

  select * into v_policy from public.sla_policies p where p.priority = p_priority;
  if not found then
    raise exception 'INVALID_PRIORITY';
  end if;

  perform public.assert_ticket_refs(p_product_id, p_category_id, null, null);

  if p_assigned_to_user_id is not null and not exists (
    select 1 from public.app_users u where u.id = p_assigned_to_user_id and u.is_active
  ) then
    raise exception 'ASSIGNEE_INACTIVE';
  end if;

  -- Empresa do contato, se ativa. Contrato = o vigente dela (derivado, nunca informado).
  select ct.customer_id into v_customer
    from public.contacts ct
    join public.customers cu on cu.id = ct.customer_id and cu.archived_at is null
   where ct.id = v_conv.contact_id;

  insert into public.tickets (
    title, description, status, priority,
    conversation_id, contact_id, customer_id, contract_id,
    product_id, category_id, assigned_to_user_id,
    source, created_by_user_id, created_by_token_id,
    idempotency_key, external_id, ai_triage,
    sla_first_response_minutes, sla_resolution_minutes, sla_warn_pct,
    first_response_due_at, resolution_due_at, created_at, updated_at
  ) values (
    pg_catalog.btrim(p_title), nullif(pg_catalog.btrim(p_description), ''),
    coalesce(p_status, 'novo'), p_priority,
    p_conversation_id, v_conv.contact_id, v_customer, public.ticket_current_contract(v_customer),
    p_product_id, p_category_id, p_assigned_to_user_id,
    v_source, p_actor_user_id, p_actor_token_id,
    p_idempotency_key, p_external_id, p_ai_triage,
    v_policy.first_response_minutes, v_policy.resolution_minutes, v_policy.warn_pct,
    v_now + pg_catalog.make_interval(mins => v_policy.first_response_minutes),
    v_now + pg_catalog.make_interval(mins => v_policy.resolution_minutes),
    v_now, v_now
  )
  on conflict do nothing
  returning * into v_t;

  -- Conflito aqui = mesma chave (ou external_id) do mesmo ator vinda de OUTRA
  -- conversa ao mesmo tempo (esta conversa está travada acima).
  if v_t.id is null then
    select * into v_existing from public.tickets t
     where (p_idempotency_key is not null
            and t.idempotency_key = p_idempotency_key
            and (t.created_by_user_id = p_actor_user_id or t.created_by_token_id = p_actor_token_id))
        or (p_external_id is not null
            and t.created_by_token_id = p_actor_token_id
            and t.external_id = p_external_id)
     limit 1;
    if v_existing.id is not null and v_existing.conversation_id = p_conversation_id then
      return pg_catalog.jsonb_build_object(
        'ticket', public.ticket_summary(v_existing.id), 'created', false, 'linked_messages', 0,
        'conversation_changed', false, 'conversation_external_id', v_conv.external_id);
    end if;
    raise exception 'IDEMPOTENCY_KEY_REUSED';
  end if;

  insert into public.ticket_status_history (
    ticket_id, from_status, to_status, actor_type, actor_user_id, actor_token_id, occurred_at
  ) values (v_t.id, null, v_t.status, v_source, p_actor_user_id, p_actor_token_id, v_now);

  perform public.ticket_record_event(v_t.id, 'ticket.created', v_source,
    p_actor_user_id, p_actor_token_id,
    pg_catalog.jsonb_build_object('source', v_source), 'ticket.created:' || v_t.id::text);

  if p_assigned_to_user_id is not null then
    perform public.ticket_record_event(v_t.id, 'ticket.assigned', v_source,
      p_actor_user_id, p_actor_token_id,
      pg_catalog.jsonb_build_object('from', null, 'to', p_assigned_to_user_id));
  end if;

  -- Soltas recentes vão para o ticket novo: até 24 h (plano §B), e nunca de antes
  -- do último ticket encerrado desta conversa (eram o fim do outro assunto).
  select pg_catalog.max(t.closed_at) into v_since
    from public.tickets t where t.conversation_id = p_conversation_id;
  v_since := greatest(v_now - interval '24 hours', coalesce(v_since, '-infinity'::timestamptz));

  with linked as (
    update public.chat_messages m
       set ticket_id = v_t.id
     where m.conversation_id = p_conversation_id
       and m.ticket_id is null
       and m.created_at >= v_since
    returning m.sender_type, m.type, m.delivery_status
  )
  select pg_catalog.count(*)::integer,
         coalesce(pg_catalog.bool_or(l.sender_type = 'agent' and l.type <> 'note'
                  and l.delivery_status in ('sent', 'delivered', 'read')), false),
         coalesce(pg_catalog.bool_or(l.sender_type = 'ai'
                  and l.delivery_status in ('sent', 'delivered', 'read')), false)
    into v_linked, v_human, v_ai
    from linked l;

  -- Pergunta Q4: resposta humana já entregue antes da abertura conta como 1ª
  -- resposta NA abertura (o cliente já foi atendido). O UPDATE do vínculo não
  -- dispara o trigger 8.7 (é OF delivery_status), por isso é feito aqui.
  if v_human or v_ai then
    update public.tickets t
       set first_responded_at   = case when v_human then t.created_at else t.first_responded_at end,
           first_ai_response_at = case when v_ai then t.created_at else t.first_ai_response_at end
     where t.id = v_t.id;
  end if;

  if v_linked > 0 then
    perform public.ticket_record_event(v_t.id, 'ticket.messages_linked', v_source,
      p_actor_user_id, p_actor_token_id,
      pg_catalog.jsonb_build_object('count', v_linked, 'since', v_since));
  end if;

  if coalesce(p_set_active, true) or v_take then
    update public.chat_conversations c set active_ticket_id = v_t.id where c.id = p_conversation_id;
    if v_conv.active_ticket_id is not null then
      perform public.ticket_record_event(v_conv.active_ticket_id, 'ticket.unfocused', v_source,
        p_actor_user_id, p_actor_token_id, pg_catalog.jsonb_build_object('next', v_t.id));
    end if;
    perform public.ticket_record_event(v_t.id, 'ticket.focused', v_source,
      p_actor_user_id, p_actor_token_id,
      pg_catalog.jsonb_build_object('previous', v_conv.active_ticket_id));
  end if;

  -- "Assumir o atendimento" na MESMA transação (4e).
  if v_take then
    v_changed := public.ticket_apply_take_over(v_t.id, p_actor_user_id);
  end if;

  return pg_catalog.jsonb_build_object(
    'ticket', public.ticket_summary(v_t.id), 'created', true, 'linked_messages', v_linked,
    'conversation_changed', v_changed, 'conversation_external_id', v_conv.external_id);
end;
$$;


-- Privilégios iguais aos de 20260925120900 (create or replace os mantém; a
-- repetição é para esta migration valer sozinha).
revoke all on function public.require_ticket_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_ticket(uuid, text, text, uuid, uuid, text, uuid, uuid, uuid, text, boolean, boolean, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_ticket(uuid, text, text, uuid, uuid, text, uuid, uuid, uuid, text, boolean, boolean, text, text, text, jsonb)
  to service_role;

-- ============================================================================
-- 3. api_idempotency_keys
-- ============================================================================
create table if not exists public.api_idempotency_keys (
  id              uuid primary key default gen_random_uuid(),
  api_token_id    uuid not null,
  idempotency_key text not null,
  method          text not null,
  -- Caminho CONCRETO, sem query string (/api/v1/tickets/<uuid>/comments),
  -- nunca o template: a mesma chave em outro recurso é reuso, não replay da
  -- resposta de outro recurso. Na v1 o caminho só tem ids, sem dado pessoal.
  route           text not null,
  -- sha256 hex do corpo canônico da requisição, calculado no app.
  request_hash    text not null,
  state           text not null default 'in_progress',
  -- Lease de quem está processando. Vencida, outra tentativa assume.
  locked_until    timestamptz,
  -- A tentativa dona da lease: só ela conclui ou libera (fencing). Quem perdeu
  -- a lease e volta depois não mexe na reserva da tentativa seguinte.
  attempt_id      uuid,
  response_status smallint,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  expires_at      timestamptz not null default (now() + interval '24 hours')
);

comment on table public.api_idempotency_keys is
  'Idempotency-Key da API v1 por token. Só as RPCs api_idempotency_* leem e gravam; expira em 24 h.';

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('api_idempotency_keys_token_key_key', 'unique (api_token_id, idempotency_key)'),
      ('api_idempotency_keys_api_token_id_fkey',
       'foreign key (api_token_id) references public.api_tokens (id) on delete cascade'),
      -- Mesmo formato de tickets.idempotency_key: a 2ª camada recebe a mesma chave.
      ('api_idempotency_keys_key_format_check',
       $c$check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$')$c$),
      ('api_idempotency_keys_method_check',
       $c$check (method in ('POST', 'PUT', 'PATCH', 'DELETE'))$c$),
      ('api_idempotency_keys_route_check',
       $c$check (route ~ '^/api/v1/' and char_length(route) <= 512)$c$),
      ('api_idempotency_keys_request_hash_check',
       $c$check (request_hash ~ '^[0-9a-f]{64}$')$c$),
      ('api_idempotency_keys_state_check',
       $c$check (
         (state = 'in_progress' and locked_until is not null and attempt_id is not null
            and response_status is null and response_body is null and completed_at is null)
         or (state = 'completed' and locked_until is null and completed_at is not null
            and response_status is not null
            and (response_status between 200 and 299 or response_status = 422))
       )$c$),
      -- A validade nunca termina antes da lease: senão o reset por validade e
      -- o purge atropelariam uma tentativa ainda em curso.
      ('api_idempotency_keys_lease_within_expiry_check',
       'check (locked_until is null or expires_at >= locked_until)'),
      -- Teto do corpo guardado: resposta de criação é pequena; algo maior é bug.
      ('api_idempotency_keys_response_body_size_check',
       'check (response_body is null or pg_catalog.pg_column_size(response_body) <= 65536)')
    ) as t(conname, definition)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.api_idempotency_keys'::regclass and conname = c.conname
    ) then
      execute format('alter table public.api_idempotency_keys add constraint %I %s', c.conname, c.definition);
    end if;
  end loop;
end
$$;

-- O expurgo varre por validade.
create index if not exists api_idempotency_keys_expires_at_idx
  on public.api_idempotency_keys (expires_at);

alter table public.api_idempotency_keys enable row level security;
revoke all on table public.api_idempotency_keys from public, anon, authenticated, service_role;

-- 3.1 begin: reserva a chave ou diz o que fazer com ela.
--   {"outcome":"started","attempt_id":U}      processe e chame finish/release com U
--   {"outcome":"replay","status":N,"body":J}  devolva a resposta guardada
--   {"outcome":"reused"}                      422 idempotency_key_reused
--   {"outcome":"in_progress"}                 409 idempotency_in_progress
-- `p_route` é o caminho concreto da requisição, sem query string.
create or replace function public.api_idempotency_begin(
  p_token_id      uuid,
  p_key           text,
  p_method        text,
  p_route         text,
  p_request_hash  text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.api_idempotency_keys%rowtype;
  v_now     timestamptz := pg_catalog.now();
  v_lease   interval;
  v_attempt uuid := pg_catalog.gen_random_uuid();
  v_started jsonb;
begin
  if p_lease_seconds is null or p_lease_seconds not between 5 and 3600 then
    raise exception 'INVALID_LEASE' using errcode = '22023';
  end if;
  v_lease := pg_catalog.make_interval(secs => p_lease_seconds);
  v_started := pg_catalog.jsonb_build_object('outcome', 'started', 'attempt_id', v_attempt);

  -- O laço cobre uma corrida: o INSERT esbarra na linha de outra tentativa, e
  -- ela é apagada (release/purge) antes do SELECT. Sem a linha, a chave está
  -- livre: tenta de novo. Esgotado, "in_progress" é a resposta segura (409).
  for v_try in 1..3 loop
    insert into public.api_idempotency_keys
      (api_token_id, idempotency_key, method, route, request_hash, locked_until, attempt_id)
    values
      (p_token_id, p_key, p_method, p_route, p_request_hash, v_now + v_lease, v_attempt)
    on conflict (api_token_id, idempotency_key) do nothing;
    if found then
      return v_started;
    end if;

    select * into v_row from public.api_idempotency_keys k
     where k.api_token_id = p_token_id and k.idempotency_key = p_key
       for update;
    if not found then
      continue;
    end if;

    -- Vencida: a chave vale de novo, como se nunca tivesse sido usada. Pelo
    -- check, validade vencida implica lease vencida: não atropela ninguém.
    if v_row.expires_at <= v_now then
      update public.api_idempotency_keys
         set method = p_method, route = p_route, request_hash = p_request_hash,
             state = 'in_progress', locked_until = v_now + v_lease, attempt_id = v_attempt,
             response_status = null, response_body = null, completed_at = null,
             created_at = v_now, expires_at = v_now + interval '24 hours'
       where id = v_row.id;
      return v_started;
    end if;

    if v_row.method <> p_method or v_row.route <> p_route or v_row.request_hash <> p_request_hash then
      return pg_catalog.jsonb_build_object('outcome', 'reused');
    end if;

    if v_row.state = 'completed' then
      return pg_catalog.jsonb_build_object(
        'outcome', 'replay', 'status', v_row.response_status, 'body', v_row.response_body);
    end if;

    if v_row.locked_until > v_now then
      return pg_catalog.jsonb_build_object('outcome', 'in_progress');
    end if;

    -- Lease vencida: quem a tinha morreu no meio; esta tentativa assume, com
    -- attempt_id novo (a anterior, se voltar, não conclui nem libera).
    update public.api_idempotency_keys
       set locked_until = v_now + v_lease,
           attempt_id   = v_attempt,
           expires_at   = greatest(expires_at, v_now + v_lease)
     where id = v_row.id;
    return v_started;
  end loop;

  return pg_catalog.jsonb_build_object('outcome', 'in_progress');
end;
$$;

-- 3.2 finish: guarda a resposta da tentativa dona da lease (só 2xx e 422; o
-- check recusa o resto). Quem perdeu a lease recebe P0002.
create or replace function public.api_idempotency_finish(
  p_token_id   uuid,
  p_key        text,
  p_attempt_id uuid,
  p_status     smallint,
  p_body       jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  update public.api_idempotency_keys
     set state = 'completed', locked_until = null,
         response_status = p_status, response_body = p_body,
         completed_at = pg_catalog.now()
   where api_token_id = p_token_id
     and idempotency_key = p_key
     and state = 'in_progress'
     and attempt_id = p_attempt_id;
  if not found then
    raise exception 'IDEMPOTENCY_NOT_IN_PROGRESS' using errcode = 'P0002',
      detail = 'A chave não está em curso por esta tentativa (lease perdida ou liberada).';
  end if;
end;
$$;

-- 3.3 release: a tentativa falhou (5xx ou erro que não se guarda); a chave
-- volta a valer. Só a tentativa dona apaga, e só o que ainda está em curso.
create or replace function public.api_idempotency_release(p_token_id uuid, p_key text, p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.api_idempotency_keys
   where api_token_id = p_token_id
     and idempotency_key = p_key
     and state = 'in_progress'
     and attempt_id = p_attempt_id;
end;
$$;

-- 3.4 purge: apaga as chaves vencidas. Devolve quantas.
create or replace function public.api_idempotency_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.api_idempotency_keys where expires_at <= pg_catalog.now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ============================================================================
-- 4. purge_integration_logs: retenção de 90 dias (D9), que é também o piso:
--    integration_logs é append-only para o service_role; só esta função apaga.
-- ============================================================================
create or replace function public.purge_integration_logs(p_older_than interval default interval '90 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_older_than is null or p_older_than < interval '90 days' then
    raise exception 'INVALID_RETENTION' using errcode = '22023',
      detail = 'Retenção mínima de 90 dias (D9): a trilha é append-only e só perde o que passou dela.';
  end if;
  delete from public.integration_logs where created_at < pg_catalog.now() - p_older_than;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.api_idempotency_begin(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.api_idempotency_finish(uuid, text, uuid, smallint, jsonb)
  from public, anon, authenticated;
revoke all on function public.api_idempotency_release(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.api_idempotency_purge()
  from public, anon, authenticated;
revoke all on function public.purge_integration_logs(interval)
  from public, anon, authenticated;

grant execute on function public.api_idempotency_begin(uuid, text, text, text, text, integer) to service_role;
grant execute on function public.api_idempotency_finish(uuid, text, uuid, smallint, jsonb) to service_role;
grant execute on function public.api_idempotency_release(uuid, text, uuid) to service_role;
grant execute on function public.api_idempotency_purge() to service_role;
grant execute on function public.purge_integration_logs(interval) to service_role;

select public.assert_security_baseline();
