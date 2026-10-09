-- ============================================================================
--   20261009130000_webhooks_saida.sql  —  Fase 6c-1: webhooks de saída (banco)
--
--   Decisão 6 do plano: mudou o ticket → o CRM emite um EVENTO ASSINADO para
--   quem assinou (a IA, o n8n, um ERP). Esta migration é o lado do banco:
--
--     1. `webhook_subscriptions`: os destinos (URL + eventos + segredo no
--        Vault, nunca em coluna). Escrita pelo servidor (admin, pela tela).
--     2. `webhook_emit(evento, id, quando, dados)`: o fan-out. Para cada
--        destino ATIVO que assinou o evento, enfileira uma linha `webhook` no
--        `event_outbox` (Fase 6b), com chave `<id do evento>:<destino>` — o
--        mesmo evento nunca entra duas vezes para o mesmo destino.
--     3. Gatilhos que chamam o fan-out NA MESMA TRANSAÇÃO da mudança
--        (outbox transacional, plano §A.5): ticket criado/alterado/atribuído
--        (`ticket_events`), status (`ticket_status_history`, + reaberto),
--        comentário, anexo e SLA estourado (os carimbos do `sla_sweep`, uma
--        vez por ticket e por prazo).
--     4. `outbox_requeue(id)`: o reenvio manual de uma entrega que esgotou as
--        tentativas (dead_letter).
--
--   O envio (assinatura HMAC, tentativas, backoff) é do worker, na 6c-2. O
--   corpo leva só ids e o que mudou — o comentário vai sem o texto, a
--   descrição vai como `{"changed":true}` —, e o despachante acrescenta o
--   ticket atual na hora de enviar.
--
--   Sem destino ativo, os gatilhos não enfileiram nada: custo de um SELECT.
--   Aditiva e idempotente; termina com assert_security_baseline().
-- ============================================================================

do $$
begin
  if to_regclass('public.event_outbox') is null
     or to_regprocedure('public.outbox_enqueue(text, text, jsonb)') is null
     or to_regclass('public.ticket_events') is null
     or to_regclass('public.ticket_status_history') is null
     or to_regclass('public.ticket_comments') is null
     or to_regclass('public.ticket_attachments') is null
     or to_regclass('public.app_users') is null
     or to_regprocedure('public.assert_security_baseline()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'WEBHOOKS_SAIDA: aplique as migrations de tickets e do event_outbox antes';
  end if;
end
$$;

-- ============================================================================
-- 1. webhook_subscriptions — os destinos
-- ============================================================================

-- Nome de evento no formato do catálogo ("ticket.status_changed"). A lista de
-- eventos válidos é do app (o catálogo cresce sem migration); aqui só o formato.
create or replace function public.webhook_events_valid(p_events text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.cardinality(p_events) between 1 and 50
     and not exists (
       select 1 from pg_catalog.unnest(p_events) e
        where e is null or e !~ '^[a-z]+\.[a-z_]{3,40}$'
     );
$$;

create table if not exists public.webhook_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  url                text not null,
  events             text[] not null,
  -- O segredo da assinatura HMAC mora no Vault; aqui só o id. Escrito pela RPC
  -- set_webhook_subscription_secret (o service_role não tem UPDATE nesta coluna).
  secret_id          uuid,
  is_active          boolean not null default true,
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint webhook_subscriptions_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint webhook_subscriptions_name_check
    check (pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 80),
  -- O app confere de verdade (HTTPS em produção, sem endereço interno); aqui só
  -- o formato e o tamanho.
  constraint webhook_subscriptions_url_check
    check (url ~ '^https?://[^[:space:]]+$' and pg_catalog.char_length(url) <= 2000),
  constraint webhook_subscriptions_events_check
    check (public.webhook_events_valid(events))
);

comment on table public.webhook_subscriptions is
  'Destinos dos webhooks de saída (Fase 6c): URL, eventos assinados e o id do segredo HMAC no Vault. Escrita só pelo servidor.';

-- O fan-out procura os ativos que assinaram o evento.
create index if not exists webhook_subscriptions_active_events_idx
  on public.webhook_subscriptions using gin (events) where is_active;

alter table public.webhook_subscriptions enable row level security;

revoke all on table public.webhook_subscriptions from public, anon, authenticated, service_role;
grant select, insert, delete on table public.webhook_subscriptions to service_role;
-- UPDATE por coluna: o `secret_id` só muda pela RPC (SECURITY DEFINER).
grant update (name, url, events, is_active, updated_at) on table public.webhook_subscriptions to service_role;

drop trigger if exists trg_webhook_subscriptions_set_updated_at on public.webhook_subscriptions;
create trigger trg_webhook_subscriptions_set_updated_at
  before update on public.webhook_subscriptions
  for each row execute function public.set_updated_at();

-- Apagar o destino apaga o segredo dele no Vault (molde de chat_integrations).
create or replace function public.delete_webhook_subscription_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.secret_id is not null then
    delete from vault.secrets s where s.id = old.secret_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_webhook_subscriptions_delete_vault_secret on public.webhook_subscriptions;
create trigger trg_webhook_subscriptions_delete_vault_secret
  after delete on public.webhook_subscriptions
  for each row execute function public.delete_webhook_subscription_vault_secret();

-- Grava (ou troca) o segredo do destino no Vault. Molde de
-- set_chat_integration_secret: valor nunca em tabela, só o id.
create or replace function public.set_webhook_subscription_secret(p_subscription_id uuid, p_value text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_name text;
  v_description constant text := 'Gerenciado pelo CRM Suporte (webhooks de saída)';
begin
  if p_value is null or pg_catalog.length(p_value) < 32 or pg_catalog.length(p_value) > 4096 then
    raise exception 'invalid_webhook_secret_value' using errcode = '22023';
  end if;

  -- A trava da linha serializa duas trocas do mesmo segredo.
  select w.secret_id into v_secret_id
    from public.webhook_subscriptions w
   where w.id = p_subscription_id
     for update;
  if not found then
    raise exception 'webhook_subscription_not_found' using errcode = 'P0002';
  end if;

  if v_secret_id is not null and not exists (select 1 from vault.secrets s where s.id = v_secret_id) then
    v_secret_id := null;
  end if;

  v_name := 'crm_suporte_webhook_subscription.' || p_subscription_id::text;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_value, v_name, v_description);
    update public.webhook_subscriptions
       set secret_id = v_secret_id, updated_at = pg_catalog.now()
     where id = p_subscription_id;
  else
    perform vault.update_secret(v_secret_id, p_value, v_name, v_description);
    update public.webhook_subscriptions set updated_at = pg_catalog.now() where id = p_subscription_id;
  end if;

  return true;
end;
$$;

-- Lê o segredo do destino. Nulo = sem segredo: quem envia falha fechado.
create or replace function public.get_webhook_subscription_secret(p_subscription_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
    from public.webhook_subscriptions w
    join vault.decrypted_secrets d on d.id = w.secret_id
   where w.id = p_subscription_id;
$$;

-- ============================================================================
-- 2. Fan-out para o event_outbox
-- ============================================================================

-- Enfileira o evento para cada destino ATIVO que o assinou. Devolve quantos.
-- Chave `<id do evento>:<destino>`: repetir o mesmo evento não duplica.
create or replace function public.webhook_emit(
  p_event       text,
  p_event_id    text,
  p_occurred_at timestamptz,
  p_data        jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub record;
  v_count integer := 0;
begin
  for v_sub in
    -- `@>` (e não `= any`) usa o índice GIN parcial dos ativos.
    select w.id from public.webhook_subscriptions w
     where w.is_active and w.events @> array[p_event]
  loop
    perform public.outbox_enqueue(
      'webhook',
      p_event_id || ':' || v_sub.id::text,
      pg_catalog.jsonb_build_object(
        'subscription_id', v_sub.id,
        'event', p_event,
        'event_id', p_event_id,
        'occurred_at', p_occurred_at,
        'data', coalesce(p_data, '{}'::jsonb)
      )
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ============================================================================
-- 3. Gatilhos (mesma transação da mudança)
-- ============================================================================

-- ticket_events: criado, alterado (e prioridade), atribuído. Os eventos
-- internos (foco, mensagens ligadas, handoff) não saem por aqui.
create or replace function public.webhook_on_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb := pg_catalog.jsonb_build_object(
    'ticket_id', new.ticket_id, 'actor_type', new.actor_type, 'metadata', new.metadata);
begin
  if new.event_type in ('ticket.created', 'ticket.updated', 'ticket.assigned') then
    perform public.webhook_emit(new.event_type, new.id::text, new.occurred_at, v_data);
  end if;
  if new.event_type = 'ticket.updated' and (new.metadata -> 'changes') ? 'priority' then
    perform public.webhook_emit('ticket.priority_changed', new.id::text || ':priority', new.occurred_at, v_data);
  end if;
  return null;
end;
$$;

-- ticket_status_history: toda TRANSIÇÃO de status; sair de "resolvido" para
-- atendimento também é `ticket.reopened` (fechar/cancelar não é reabrir). A
-- linha da abertura (nada → novo) não sai aqui: a abertura é `ticket.created`,
-- e quem assina status receberia o mesmo fato duas vezes.
create or replace function public.webhook_on_ticket_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb := pg_catalog.jsonb_build_object(
    'ticket_id', new.ticket_id, 'from', new.from_status, 'to', new.to_status,
    'actor_type', new.actor_type, 'reason', new.reason);
begin
  if new.from_status is null then
    return null;
  end if;
  perform public.webhook_emit('ticket.status_changed', new.id::text, new.occurred_at, v_data);
  if new.from_status = 'resolvido' and new.to_status not in ('fechado', 'cancelado') then
    perform public.webhook_emit('ticket.reopened', new.id::text || ':reopened', new.occurred_at, v_data);
  end if;
  return null;
end;
$$;

-- Comentário (nota interna): SEM o texto — quem precisa lê pela API v1, com
-- o escopo próprio.
create or replace function public.webhook_on_ticket_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.webhook_emit('ticket.comment_added', new.id::text, new.created_at,
    pg_catalog.jsonb_build_object(
      'ticket_id', new.ticket_id, 'comment_id', new.id,
      'author_type', case when new.author_token_id is not null then 'api' else 'agent' end));
  return null;
end;
$$;

create or replace function public.webhook_on_ticket_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.webhook_emit('ticket.attachment_added', new.id::text, new.created_at,
    pg_catalog.jsonb_build_object(
      'ticket_id', new.ticket_id, 'attachment_id', new.id,
      'file_name', new.file_name, 'mime', new.mime, 'size_bytes', new.size_bytes));
  return null;
end;
$$;

-- SLA estourado: o `sla_sweep` carimba cada prazo UMA vez; o id do evento é
-- `<ticket>:sla:<prazo>`, então ele sai uma vez por ticket e por prazo.
create or replace function public.webhook_on_ticket_sla_breach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.first_response_breached_at is null and new.first_response_breached_at is not null then
    perform public.webhook_emit('ticket.sla_breached', new.id::text || ':sla:first_response',
      new.first_response_breached_at,
      pg_catalog.jsonb_build_object('ticket_id', new.id, 'deadline', 'first_response'));
  end if;
  if old.resolution_breached_at is null and new.resolution_breached_at is not null then
    perform public.webhook_emit('ticket.sla_breached', new.id::text || ':sla:resolution',
      new.resolution_breached_at,
      pg_catalog.jsonb_build_object('ticket_id', new.id, 'deadline', 'resolution'));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_ticket_events_webhook on public.ticket_events;
create trigger trg_ticket_events_webhook
  after insert on public.ticket_events
  for each row execute function public.webhook_on_ticket_event();

drop trigger if exists trg_ticket_status_history_webhook on public.ticket_status_history;
create trigger trg_ticket_status_history_webhook
  after insert on public.ticket_status_history
  for each row execute function public.webhook_on_ticket_status();

drop trigger if exists trg_ticket_comments_webhook on public.ticket_comments;
create trigger trg_ticket_comments_webhook
  after insert on public.ticket_comments
  for each row execute function public.webhook_on_ticket_comment();

drop trigger if exists trg_ticket_attachments_webhook on public.ticket_attachments;
create trigger trg_ticket_attachments_webhook
  after insert on public.ticket_attachments
  for each row execute function public.webhook_on_ticket_attachment();

drop trigger if exists trg_tickets_webhook_sla_breach on public.tickets;
create trigger trg_tickets_webhook_sla_breach
  after update of first_response_breached_at, resolution_breached_at on public.tickets
  for each row
  when (
    (old.first_response_breached_at is null and new.first_response_breached_at is not null)
    or (old.resolution_breached_at is null and new.resolution_breached_at is not null)
  )
  execute function public.webhook_on_ticket_sla_breach();

-- ============================================================================
-- 4. Reenvio manual de uma entrega esgotada
-- ============================================================================

-- Só `webhook` em `dead_letter`: volta para a fila com as tentativas zeradas.
-- O relay não entra (a janela útil da mensagem é de 2 minutos). Devolve se
-- reenfileirou.
create or replace function public.outbox_requeue(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_outbox o
     set status = 'pending', attempts = 0, next_attempt_at = pg_catalog.now(),
         lease_token = null, lease_owner = null, lease_expires_at = null,
         last_error = null, updated_at = pg_catalog.now()
   where o.id = p_id and o.kind = 'webhook' and o.status = 'dead_letter';
  return found;
end;
$$;

-- ============================================================================
-- 5. Privilégios de função (no Postgres a função nasce executável por PUBLIC)
-- ============================================================================

revoke all on function public.webhook_events_valid(text[]) from public, anon, authenticated;
revoke all on function public.delete_webhook_subscription_vault_secret() from public, anon, authenticated;
revoke all on function public.set_webhook_subscription_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.get_webhook_subscription_secret(uuid) from public, anon, authenticated;
revoke all on function public.webhook_emit(text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.webhook_on_ticket_event() from public, anon, authenticated;
revoke all on function public.webhook_on_ticket_status() from public, anon, authenticated;
revoke all on function public.webhook_on_ticket_comment() from public, anon, authenticated;
revoke all on function public.webhook_on_ticket_attachment() from public, anon, authenticated;
revoke all on function public.webhook_on_ticket_sla_breach() from public, anon, authenticated;
revoke all on function public.outbox_requeue(uuid) from public, anon, authenticated;

grant execute on function public.webhook_events_valid(text[]) to service_role;
grant execute on function public.delete_webhook_subscription_vault_secret() to service_role;
grant execute on function public.set_webhook_subscription_secret(uuid, text) to service_role;
grant execute on function public.get_webhook_subscription_secret(uuid) to service_role;
grant execute on function public.webhook_emit(text, text, timestamptz, jsonb) to service_role;
grant execute on function public.webhook_on_ticket_event() to service_role;
grant execute on function public.webhook_on_ticket_status() to service_role;
grant execute on function public.webhook_on_ticket_comment() to service_role;
grant execute on function public.webhook_on_ticket_attachment() to service_role;
grant execute on function public.webhook_on_ticket_sla_breach() to service_role;
grant execute on function public.outbox_requeue(uuid) to service_role;

-- O PostgREST guarda o schema em cache; sem o reload ele segue com o mapa antigo.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
