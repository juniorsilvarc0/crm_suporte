-- ============================================================================
--   20261008140000_event_outbox.sql  —  Fase 6b: outbox de entrega com retry
--
--   Fila DURÁVEL de eventos a entregar (relay à IA, e depois webhooks de
--   integradores), com lease + backoff + dead_letter. Padrão do projeto irmão
--   (outbox de conversões Meta): claim por `for update skip locked`, finish com
--   FENCING por lease_token. Esta PR entrega só a INFRA — nenhum produtor nem
--   consumidor ainda (o relay migra na 6b-1b).
--
--   Escrita só pelas RPCs (security definer, dona = migrations); service_role só
--   EXECUTE — nada toca a tabela direto (molde job_leases/api_idempotency).
-- ============================================================================

do $$
begin
  if to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'EVENT_OUTBOX: aplique a fundação antes';
  end if;
end
$$;

create table if not exists public.event_outbox (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,
  -- Idempotência de ENFILEIRAMENTO: o mesmo evento não entra duas vezes.
  event_key        text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending',
  attempts         integer not null default 0,
  -- Backoff: a próxima tentativa não sai antes disto.
  next_attempt_at  timestamptz not null default now(),
  -- Lease/fencing do claim: só o dono (lease_token) finaliza.
  lease_token      uuid,
  lease_owner      text,
  lease_expires_at timestamptz,
  last_http_status smallint,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  delivered_at     timestamptz,
  constraint event_outbox_kind_check check (kind in ('relay', 'webhook')),
  constraint event_outbox_identity_uidx unique (kind, event_key),
  constraint event_outbox_event_key_check
    check (pg_catalog.btrim(event_key) <> '' and pg_catalog.char_length(event_key) <= 200),
  constraint event_outbox_status_check
    check (status in ('pending', 'processing', 'retry', 'sent', 'dead_letter', 'skipped')),
  constraint event_outbox_attempts_check check (attempts >= 0),
  constraint event_outbox_http_status_check
    check (last_http_status is null or last_http_status between 100 and 599)
);

comment on table public.event_outbox is
  'Fila durável de entrega (Fase 6): relay à IA e webhooks. Lease + backoff + dead_letter. Escrita só pelas RPCs outbox_enqueue/claim/settle (service_role só EXECUTE).';

-- Varredura do claim: prontas por kind, em ordem de prazo.
create index if not exists event_outbox_ready_idx
  on public.event_outbox (kind, next_attempt_at, created_at)
  where status in ('pending', 'retry');

-- Lease vencida a reivindicar.
create index if not exists event_outbox_processing_idx
  on public.event_outbox (lease_expires_at)
  where status = 'processing';

alter table public.event_outbox enable row level security;
-- Nenhum grant direto: a tabela é escrita só pelas RPCs (dona = migrations).
revoke all on table public.event_outbox from public, anon, authenticated, service_role;

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Enfileira (idempotente por kind+event_key). Devolve o id (novo ou o existente).
create or replace function public.outbox_enqueue(p_kind text, p_event_key text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.event_outbox (kind, event_key, payload)
    values (p_kind, p_event_key, coalesce(p_payload, '{}'::jsonb))
    on conflict (kind, event_key) do nothing
  returning id into v_id;

  if v_id is null then
    select o.id into v_id
      from public.event_outbox o
     where o.kind = p_kind and o.event_key = p_event_key;
  end if;
  return v_id;
end;
$$;

comment on function public.outbox_enqueue(text, text, jsonb) is
  'Enfileira um evento (idempotente por kind+event_key). Devolve o id da linha.';

-- Reivindica até p_limit eventos prontos de p_kind, com FOR UPDATE SKIP LOCKED.
-- Esgotados (tentativas >= p_max_attempts) ou velhos (> p_max_age_seconds) viram
-- dead_letter e NÃO são entregues — para o relay, p_max_age_seconds = 120 (a
-- mensagem perde valor para a IA responder).
create or replace function public.outbox_claim(
  p_owner           text,
  p_kind            text,
  p_limit           integer,
  p_max_attempts    integer,
  p_max_age_seconds integer
)
returns setof public.event_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Mata o esgotado/velho que está ESPERANDO, ou o órfão (processing com lease
  -- expirada — o worker morreu). NUNCA mata um processing com lease viva: ele está
  -- em voo com o dono dele; matá-lo faria o settle do dono falhar (fencing) e
  -- perderíamos o registro de uma entrega que talvez tenha dado certo.
  update public.event_outbox o
     set status = 'dead_letter', lease_token = null, lease_owner = null,
         lease_expires_at = null, updated_at = pg_catalog.now()
   where o.kind = p_kind
     and (o.attempts >= p_max_attempts
          or o.created_at <= pg_catalog.now()
             - pg_catalog.make_interval(secs => p_max_age_seconds))
     and (
       o.status in ('pending', 'retry')
       or (o.status = 'processing' and o.lease_expires_at < pg_catalog.now())
     );

  return query
  with ready as (
    select o.id
      from public.event_outbox o
     where o.kind = p_kind
       and o.attempts < p_max_attempts
       and o.created_at > pg_catalog.now() - pg_catalog.make_interval(secs => p_max_age_seconds)
       and (
         (o.status in ('pending', 'retry') and o.next_attempt_at <= pg_catalog.now())
         or (o.status = 'processing' and o.lease_expires_at < pg_catalog.now())
       )
     order by o.next_attempt_at, o.created_at
       for update skip locked
     limit greatest(least(p_limit, 100), 1)
  )
  update public.event_outbox o
     set status = 'processing',
         attempts = o.attempts + 1,
         lease_token = pg_catalog.gen_random_uuid(),
         lease_owner = p_owner,
         lease_expires_at = pg_catalog.now() + interval '2 minutes',
         updated_at = pg_catalog.now()
    from ready
   where o.id = ready.id
  returning o.*;
end;
$$;

comment on function public.outbox_claim(text, text, integer, integer, integer) is
  'Reivindica até p_limit eventos prontos de p_kind (skip locked); esgotados/velhos viram dead_letter. Para relay: p_max_age_seconds=120.';

-- Finaliza um evento. FENCING: só o dono da lease (p_lease_token) finaliza. O
-- worker calcula o next_attempt_at (backoff) e passa pronto.
create or replace function public.outbox_settle(
  p_id             uuid,
  p_lease_token    uuid,
  p_status         text,
  p_next_attempt_at timestamptz,
  p_http_status    integer,
  p_error          text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_status not in ('sent', 'retry', 'dead_letter', 'skipped') then
    raise exception 'INVALID_OUTBOX_STATUS';
  end if;

  update public.event_outbox o
     set status = p_status,
         next_attempt_at = coalesce(p_next_attempt_at, o.next_attempt_at),
         last_http_status = p_http_status,
         last_error = pg_catalog.left(p_error, 500),
         delivered_at = case when p_status = 'sent' then pg_catalog.now() else o.delivered_at end,
         lease_token = null, lease_owner = null, lease_expires_at = null,
         updated_at = pg_catalog.now()
   where o.id = p_id
     and o.status = 'processing'
     and o.lease_token = p_lease_token;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

comment on function public.outbox_settle(uuid, uuid, text, timestamptz, integer, text) is
  'Finaliza o evento (sent/retry/dead_letter/skipped). Só o dono da lease finaliza (fencing).';

revoke all on function public.outbox_enqueue(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.outbox_enqueue(text, text, jsonb) to service_role;
revoke all on function public.outbox_claim(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.outbox_claim(text, text, integer, integer, integer) to service_role;
revoke all on function public.outbox_settle(uuid, uuid, text, timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.outbox_settle(uuid, uuid, text, timestamptz, integer, text) to service_role;

notify pgrst, 'reload schema';

select public.assert_security_baseline();
