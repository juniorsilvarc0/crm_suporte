-- ============================================================================
-- Fase 5 · PR 9 — banco das conversas da IA (docs/PLANO-FASE-5.md, D10 e D12).
--
-- 1. chat_messages.sent_by_token_id: o token que escreveu a mensagem pela API
--    v1 (D10). É coluna, e não uma chave no metadata, pelo mesmo motivo de
--    ticket, comentário e anexo: tem FK e índice, e ninguém a troca depois
--    (fica fora do grant de UPDATE, como sent_by_user_id). A mensagem tem no
--    máximo um autor, e o sender_type da mensagem de um token é o TIPO do
--    token: ai escreve como 'ai'; api, como 'system'. Assim um token nunca
--    passa por analista ('agent' é o que a 1ª resposta HUMANA do SLA conta),
--    e uma integração não carimba a 1ª resposta da IA.
--    O inverso não é exigido ('ai' sem token passa): o eco de uma IA que
--    ainda envia direto pela uazapi (D2) pode um dia ser classificado assim.
--    A coluna sai no Realtime e no PostgREST para o operador logado, como
--    ticket_id: é só o id do token, e api_tokens não tem grant nem policy para
--    authenticated.
-- 2. create_ticket deixa de contar NOTA interna da IA como 1ª resposta da IA
--    ao vincular as mensagens soltas (o ramo humano já ignorava a nota).
-- 3. conversation_handoff: a IA (ou uma integração) passa a conversa de bot
--    para human (D12). Só nesse sentido; a volta é pela tela. Com a conversa
--    travada:
--      - deixa uma NOTA INTERNA no chat, assinada pelo token, com o motivo e
--        o resumo. É onde o analista lê ao assumir, com ou sem ticket; e a
--        tabela permite apagar (is_deleted zera o texto), o que a trilha não
--        permite. Pela tela, hoje só o autor usuário apaga uma nota: quem
--        apaga a da IA fica para a rota do PR 10;
--      - registra ticket.handoff_requested no ticket informado ou, na falta
--        dele, no ticket em foco, só com o motivo (curto, como o motivo de uma
--        mudança de status). O resumo NÃO entra na trilha: ela é append-only
--        e sai inteira para quem tem tickets:read.
--
-- Idempotente; depende de 20260929170000 (require_ticket_actor devolve o tipo
-- do token, e é de lá o corpo de create_ticket).
-- ============================================================================

do $$
begin
  if to_regclass('public.chat_messages') is null
     or to_regclass('public.ticket_events') is null
     or not exists (
       select 1 from pg_catalog.pg_attribute a
        where a.attrelid = to_regclass('public.api_tokens')
          and a.attname = 'actor_type'
          and not a.attisdropped
     ) then
    raise exception 'CONVERSAS DA IA: aplique 20260929170000_api_v1_fundacao antes';
  end if;
end
$$;

-- chat_messages recebe mensagem o tempo todo. Se algo estiver segurando a
-- tabela (o pg_dump do backup, uma sessão esquecida em transação), o ALTER
-- TABLE esperaria na fila, com todo o chat atrás dele. Com o limite, a
-- migration desiste em 5 s sem mudar nada, e basta aplicar de novo. Vale até o
-- COMMIT: os scripts aplicam cada migration numa transação só.
set local lock_timeout = '5s';

-- ============================================================================
-- 1. chat_messages.sent_by_token_id
-- ============================================================================
alter table public.chat_messages
  add column if not exists sent_by_token_id uuid;

do $$
declare
  c record;
begin
  for c in
    select * from (values
      -- restrict, como nas outras autorias de token: o app só revoga, não apaga.
      ('chat_messages_sent_by_token_id_fkey',
       'foreign key (sent_by_token_id) references public.api_tokens (id) on delete restrict'),
      ('chat_messages_one_author',
       'check (num_nonnulls(sent_by_user_id, sent_by_token_id) <= 1)')
    ) as t(conname, definition)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.chat_messages'::regclass and conname = c.conname
    ) then
      execute format('alter table public.chat_messages add constraint %I %s', c.conname, c.definition);
    end if;
  end loop;
end
$$;

-- FK com ação: sem índice, conferir um token varreria a tabela inteira.
create index if not exists chat_messages_sent_by_token_id_idx
  on public.chat_messages (sent_by_token_id)
  where sent_by_token_id is not null;

comment on column public.chat_messages.sent_by_token_id is
  'Token da API v1 que escreveu a mensagem. O sender_type é o tipo do token (ai → ai; api → system). Fixo depois do INSERT; nunca junto com sent_by_user_id.';

-- O remetente é o tipo do token, para qualquer escritor: sem isto, um sender
-- esquecido no TS daria a mensagem do token por resposta do analista (1ª
-- resposta do SLA), por fala do cliente, ou a de uma integração por resposta
-- da IA. É o par de create_ticket, que tira a origem do ticket do tipo do
-- token. Token inexistente fica para a FK (23503).
-- Nome "guard" ordena antes de "scrub_deleted" e "stamp_ticket": recusa antes
-- de travar a conversa. Não trava nada.
create or replace function public.guard_chat_message_token_author()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
begin
  select t.actor_type into v_type from public.api_tokens t where t.id = new.sent_by_token_id;
  if found and new.sender_type is distinct from (case v_type when 'ai' then 'ai' else 'system' end) then
    raise exception 'INVALID_SENDER'
      using detail = 'O remetente da mensagem é o tipo do token: ai escreve como ai; api, como system.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_guard_token_author on public.chat_messages;
create trigger trg_chat_messages_guard_token_author
  before insert on public.chat_messages
  for each row when (new.sent_by_token_id is not null)
  execute function public.guard_chat_message_token_author();

-- ============================================================================
-- 2. create_ticket: nota interna da IA não conta como 1ª resposta da IA
-- ============================================================================
-- Ao abrir o ticket, as mensagens soltas recentes entram nele, e uma resposta
-- já entregue conta como 1ª resposta NA abertura. O ramo humano já ignorava a
-- nota; o da IA, não. Passou a importar: o handoff deixa uma nota da IA (seção
-- 3), e ela, solta numa conversa sem ticket, carimbaria first_ai_response_at
-- do ticket aberto depois, sem a IA ter respondido ao cliente.
-- Corpo de 20260929170000 com UMA troca (`and l.type <> 'note'` no bool_or da
-- IA). O resto é idêntico, linha a linha.
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
         coalesce(pg_catalog.bool_or(l.sender_type = 'ai' and l.type <> 'note'
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

-- ============================================================================
-- 3. conversation_handoff: bot → human, pelo token
-- ============================================================================
-- Devolve {conversation_id, status, changed, ticket_id, note_id,
-- conversation_external_id}.
--   changed = false: a conversa já era de um humano; nada é gravado.
--   ticket_id: o ticket em que o pedido entrou na trilha (nulo se não houve).
--   note_id: a nota interna deixada no chat.
--   conversation_external_id: para o serviço avisar o agente (pushTakeoverToAgent);
--     não sai na resposta da API.
-- Erros: FORBIDDEN (token revogado, vencido ou inexistente), INVALID_ACTOR (sem
-- token), INVALID_HANDOFF (motivo ou resumo fora do tamanho), CONVERSATION_NOT_FOUND,
-- TICKET_NOT_IN_CONVERSATION, TICKET_TERMINAL e CONVERSATION_NOT_OWNED_BY_AI
-- (conversa resolvida; HINT = status atual).
-- Ordem das travas, a mesma das RPCs de ticket: gestão de usuários (dentro de
-- require_ticket_actor) → conversa FOR UPDATE → ticket. O INSERT da nota não
-- toca em contacts (touch_contact_from_inserted_message ignora nota), então a
-- ordem contacts → conversa, de quem renomeia o contato, nunca se inverte aqui.
create or replace function public.conversation_handoff(
  p_conversation_id uuid,
  p_actor_token_id  uuid,
  p_reason          text,
  p_summary         text default null,
  p_ticket_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   text;
  v_reason  text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_summary text := nullif(pg_catalog.btrim(coalesce(p_summary, '')), '');
  v_conv    public.chat_conversations%rowtype;
  v_ticket  uuid;
  v_note    uuid;
  v_t       public.tickets%rowtype;
begin
  -- Só token: o analista assume pela tela (ticket_take_over ou o PATCH da conversa).
  v_actor := public.require_ticket_actor(null, p_actor_token_id);

  if v_reason = '' or pg_catalog.char_length(v_reason) > 500 then
    raise exception 'INVALID_HANDOFF' using detail = 'Motivo de 1 a 500 caracteres.';
  end if;
  if pg_catalog.char_length(v_summary) > 4000 then
    raise exception 'INVALID_HANDOFF' using detail = 'Resumo de até 4.000 caracteres.';
  end if;

  -- FOR UPDATE: serializa com a mensagem que chega (o carimbo e a reabertura
  -- de resolved→bot) e com a transição para terminal, que trava a conversa
  -- antes do ticket; por isso ler closed_at depois é seguro.
  select * into v_conv from public.chat_conversations c
   where c.id = p_conversation_id
     for update;
  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;

  if p_ticket_id is not null then
    select * into v_t from public.tickets t where t.id = p_ticket_id;
    if not found or v_t.conversation_id <> p_conversation_id then
      raise exception 'TICKET_NOT_IN_CONVERSATION';
    end if;
    if v_t.closed_at is not null then
      raise exception 'TICKET_TERMINAL';
    end if;
  end if;

  -- Já está com um humano: o pedido não muda nada e não deixa registro.
  if v_conv.status = 'human' then
    return pg_catalog.jsonb_build_object(
      'conversation_id', v_conv.id, 'status', 'human', 'changed', false,
      'ticket_id', null, 'note_id', null, 'conversation_external_id', v_conv.external_id);
  end if;

  -- Resolvida não é da IA: quem a devolve é uma mensagem nova do cliente.
  if v_conv.status <> 'bot' then
    raise exception 'CONVERSATION_NOT_OWNED_BY_AI'
      using detail = 'Só uma conversa com a IA (bot) pode ser passada para um humano.',
            hint = v_conv.status;
  end if;

  update public.chat_conversations c
     set status = 'human',
         updated_at = pg_catalog.now()
   where c.id = p_conversation_id;

  -- Nota interna: não vai ao cliente, não vira prévia nem não-lida, não conta
  -- no SLA (os triggers de mensagem ignoram type = 'note'), e o carimbo a põe
  -- no ticket em foco. `handoff` no metadata a distingue das outras notas.
  insert into public.chat_messages (
    conversation_id, direction, sender_type, type, content, delivery_status, sent_by_token_id, metadata
  ) values (
    p_conversation_id, 'outbound', case v_actor when 'ai' then 'ai' else 'system' end, 'note',
    v_reason || coalesce(E'\n\n' || v_summary, ''), 'sent', p_actor_token_id,
    pg_catalog.jsonb_build_object('handoff', true)
  )
  returning id into v_note;

  v_ticket := coalesce(p_ticket_id, v_conv.active_ticket_id);
  if v_ticket is not null then
    perform public.ticket_record_event(v_ticket, 'ticket.handoff_requested', v_actor,
      null, p_actor_token_id, pg_catalog.jsonb_build_object('reason', v_reason));
  end if;

  return pg_catalog.jsonb_build_object(
    'conversation_id', v_conv.id, 'status', 'human', 'changed', true,
    'ticket_id', v_ticket, 'note_id', v_note, 'conversation_external_id', v_conv.external_id);
end;
$$;

-- Privilégios: a função de trigger no molde de _chat/_tickets; a RPC, só o app.
revoke all on function public.guard_chat_message_token_author() from public, anon, authenticated;
grant execute on function public.guard_chat_message_token_author() to service_role;

-- create or replace mantém os privilégios; a repetição é para esta migration
-- valer sozinha (como em 20260929170000).
revoke all on function public.create_ticket(uuid, text, text, uuid, uuid, text, uuid, uuid, uuid, text, boolean, boolean, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_ticket(uuid, text, text, uuid, uuid, text, uuid, uuid, uuid, text, boolean, boolean, text, text, text, jsonb)
  to service_role;

revoke all on function public.conversation_handoff(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.conversation_handoff(uuid, uuid, text, text, uuid) to service_role;

-- ============================================================================
-- 4. Asserções locais (o que o baseline geral não confere)
-- ============================================================================
do $$
begin
  if pg_catalog.has_column_privilege('service_role', 'public.chat_messages', 'sent_by_token_id', 'UPDATE') then
    raise exception 'CONVERSAS DA IA: service_role troca o autor da mensagem; a autoria é fixa depois do INSERT';
  end if;
  if not pg_catalog.has_column_privilege('service_role', 'public.chat_messages', 'sent_by_token_id', 'INSERT') then
    raise exception 'CONVERSAS DA IA: o app não grava o token que enviou a mensagem';
  end if;
end
$$;

select public.assert_security_baseline();
