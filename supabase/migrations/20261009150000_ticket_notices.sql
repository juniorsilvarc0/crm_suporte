-- ============================================================================
--   20261009150000_ticket_notices.sql  —  Fase 6c-4: aviso ao cliente sem duplicar
--
--   Quem avisa o cliente (o agente, pelo WhatsApp) recebe os eventos de ticket
--   PELO MENOS uma vez (webhooks, 6c-2): o mesmo `ticket.status_changed` pode
--   chegar duas vezes, ou a duas instâncias do agente. Para o mesmo aviso não
--   sair duas vezes, quem avisa REIVINDICA um passo do ticket antes de enviar
--   (claim) e o FECHA depois (finalize). Só `claimed: true` autoriza o envio.
--
--   - (ticket_id, step) é único. O passo é escolhido por quem avisa: o `id` do
--     evento (um aviso por evento) ou um nome fixo, como `resolvido` (um aviso
--     por ticket, mesmo que ele volte a esse status).
--   - claim: passo livre → claimed (lease curta, `claim_token` novo); já
--     enviado → recusa `already_sent`; em curso com a lease valendo → recusa
--     `in_progress`; lease vencida sem finalize, ou falha anterior → claimed de
--     novo (attempts + 1).
--   - finalize: só com o `claim_token` da reivindicação atual (fencing: quem
--     perdeu a lease não fecha o passo de outro). `sent` fecha para sempre;
--     `failed` libera para nova tentativa.
--
--   Escrita e leitura só pelas RPCs (security definer, dona = migrations): o
--   service_role não tem grant na tabela. Aditiva e idempotente.
-- ============================================================================

do $$
begin
  if to_regclass('public.tickets') is null
     or to_regclass('public.api_tokens') is null
     or to_regprocedure('public.set_updated_at()') is null
     or to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'TICKET_NOTICES: aplique as migrations de tickets e da API v1 antes';
  end if;
end
$$;

create table if not exists public.ticket_notices (
  id                  uuid primary key default gen_random_uuid(),
  ticket_id           uuid not null,
  step                text not null,
  status              text not null default 'claimed',
  -- O segredo da reivindicação atual: só quem a recebeu finaliza.
  claim_token         uuid not null default gen_random_uuid(),
  claimed_by_token_id uuid,
  lease_expires_at    timestamptz not null,
  attempts            integer not null default 1,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  finalized_at        timestamptz,
  constraint ticket_notices_ticket_id_fkey
    foreign key (ticket_id) references public.tickets (id) on delete cascade,
  constraint ticket_notices_claimed_by_token_id_fkey
    foreign key (claimed_by_token_id) references public.api_tokens (id) on delete set null,
  constraint ticket_notices_step_check
    check (step ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  constraint ticket_notices_status_check
    check (status in ('claimed', 'sent', 'failed')),
  constraint ticket_notices_attempts_check
    check (attempts >= 1),
  constraint ticket_notices_last_error_check
    check (last_error is null or pg_catalog.char_length(last_error) <= 500),
  constraint ticket_notices_finalized_check
    check ((status = 'sent') = (finalized_at is not null)),
  constraint ticket_notices_ticket_step_key
    unique (ticket_id, step)
);

comment on table public.ticket_notices is
  'Avisos ao cliente reivindicados por quem avisa (claim/finalize): o mesmo passo do ticket não é enviado duas vezes. Só pelas RPCs.';

drop trigger if exists trg_ticket_notices_set_updated_at on public.ticket_notices;
create trigger trg_ticket_notices_set_updated_at
  before update on public.ticket_notices
  for each row execute function public.set_updated_at();

alter table public.ticket_notices enable row level security;
-- Nenhum grant direto: a tabela é lida e escrita só pelas RPCs.
revoke all on table public.ticket_notices from public, anon, authenticated, service_role;

-- ============================================================================
-- RPCs
-- ============================================================================

-- Reivindica um passo. p_lease_seconds fica entre 30 s e 15 min (padrão 2 min):
-- o tempo de mandar a mensagem e chamar o finalize. Devolve jsonb:
--   { claimed: true,  claim_token, lease_expires_at, attempts }
--   { claimed: false, reason: 'already_sent' | 'in_progress', lease_expires_at? , finalized_at? }
-- Ticket que não existe: P0002. Passo fora do formato: 22023.
create or replace function public.ticket_notice_claim(
  p_ticket_id     uuid,
  p_step          text,
  p_token_id      uuid,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice public.ticket_notices;
  v_lease  interval := pg_catalog.make_interval(
    secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900)));
begin
  if p_step is null or p_step !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' then
    raise exception 'invalid_notice_step' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tickets t where t.id = p_ticket_id) then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;

  insert into public.ticket_notices (ticket_id, step, claimed_by_token_id, lease_expires_at)
  values (p_ticket_id, p_step, p_token_id, pg_catalog.now() + v_lease)
  on conflict (ticket_id, step) do nothing
  returning * into v_notice;

  if not found then
    -- Já existe: a trava da linha serializa duas reivindicações simultâneas
    -- (a segunda espera a primeira e a vê em curso).
    select * into v_notice
      from public.ticket_notices n
     where n.ticket_id = p_ticket_id and n.step = p_step
       for update;

    if v_notice.status = 'sent' then
      return pg_catalog.jsonb_build_object(
        'claimed', false, 'reason', 'already_sent', 'finalized_at', v_notice.finalized_at);
    end if;
    if v_notice.status = 'claimed' and v_notice.lease_expires_at > pg_catalog.now() then
      return pg_catalog.jsonb_build_object(
        'claimed', false, 'reason', 'in_progress', 'lease_expires_at', v_notice.lease_expires_at);
    end if;

    update public.ticket_notices
       set status = 'claimed',
           claim_token = gen_random_uuid(),
           claimed_by_token_id = p_token_id,
           lease_expires_at = pg_catalog.now() + v_lease,
           attempts = attempts + 1
     where id = v_notice.id
    returning * into v_notice;
  end if;

  return pg_catalog.jsonb_build_object(
    'claimed', true,
    'claim_token', v_notice.claim_token,
    'lease_expires_at', v_notice.lease_expires_at,
    'attempts', v_notice.attempts);
end;
$$;

-- Fecha a reivindicação. Devolve jsonb:
--   { finalized: true,  status }                     -- inclusive a repetição do mesmo desfecho
--   { finalized: false, reason: 'claim_lost' | 'already_finalized', status }
-- Passo nunca reivindicado: P0002. Desfecho fora de sent/failed: 22023.
create or replace function public.ticket_notice_finalize(
  p_ticket_id   uuid,
  p_step        text,
  p_claim_token uuid,
  p_outcome     text,
  p_error       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice public.ticket_notices;
begin
  if p_outcome is null or p_outcome not in ('sent', 'failed') then
    raise exception 'invalid_notice_outcome' using errcode = '22023';
  end if;

  select * into v_notice
    from public.ticket_notices n
   where n.ticket_id = p_ticket_id and n.step = p_step
     for update;
  if not found then
    raise exception 'notice_not_found' using errcode = 'P0002';
  end if;

  -- Outra reivindicação assumiu (a lease venceu e alguém reivindicou de novo).
  if p_claim_token is null or v_notice.claim_token <> p_claim_token then
    return pg_catalog.jsonb_build_object('finalized', false, 'reason', 'claim_lost', 'status', v_notice.status);
  end if;
  -- Repetir o finalize que já valeu não é erro (a resposta pode ter se perdido).
  if v_notice.status = p_outcome then
    return pg_catalog.jsonb_build_object('finalized', true, 'status', v_notice.status);
  end if;
  if v_notice.status <> 'claimed' then
    return pg_catalog.jsonb_build_object('finalized', false, 'reason', 'already_finalized', 'status', v_notice.status);
  end if;

  update public.ticket_notices
     set status = p_outcome,
         finalized_at = case when p_outcome = 'sent' then pg_catalog.now() end,
         last_error = case when p_outcome = 'failed' then pg_catalog.left(nullif(pg_catalog.btrim(p_error), ''), 500) end,
         -- Fechado, a lease não segura mais nada: uma falha é reivindicável na hora.
         lease_expires_at = pg_catalog.now()
   where id = v_notice.id
  returning * into v_notice;

  return pg_catalog.jsonb_build_object('finalized', true, 'status', v_notice.status);
end;
$$;

-- ============================================================================
-- Privilégios de função (EXECUTE nasce para PUBLIC: revogar de todos)
-- ============================================================================

revoke all on function public.ticket_notice_claim(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.ticket_notice_claim(uuid, text, uuid, integer) to service_role;
revoke all on function public.ticket_notice_finalize(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.ticket_notice_finalize(uuid, text, uuid, text, text) to service_role;

-- O PostgREST guarda o schema em cache; sem o reload ele segue com o mapa antigo.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
