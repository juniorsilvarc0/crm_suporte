-- Meta Click-to-WhatsApp attribution and Conversions API outbox.
--
-- Design goals:
--   * webhook replays are idempotent;
--   * attribution assigned to a deal never changes;
--   * business events and their outbox rows are committed together;
--   * ctwa_clid is service-role-only and is redacted after 90 days;
--   * no message body or clinical data is copied into tracking tables.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Current Meta asset cache. Historical reporting never reads names directly
-- from this table; immutable name snapshots live on meta_attributions.
-- ---------------------------------------------------------------------------
create table if not exists public.meta_ad_assets (
  source_id           text primary key,
  source_type         text not null default 'ad',
  ad_id               text,
  ad_name             text,
  adset_id            text,
  adset_name          text,
  campaign_id         text,
  campaign_name       text,
  account_id          text,
  enrichment_status  text not null default 'pending',
  attempt_count       integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  last_error          text,
  refreshed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint meta_ad_assets_source_type_check
    check (source_type in ('ad', 'post', 'unknown')),
  constraint meta_ad_assets_enrichment_status_check
    check (enrichment_status in ('pending', 'enriched', 'partial', 'retry', 'error'))
);

create index if not exists meta_ad_assets_enrichment_ready_idx
  on public.meta_ad_assets (enrichment_status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- One immutable acquisition touch per Meta referral message/click.
-- ctwa_fingerprint remains after redaction so a replay cannot recreate the ID.
-- ---------------------------------------------------------------------------
create table if not exists public.meta_attributions (
  id                       uuid primary key default gen_random_uuid(),
  lead_id                  uuid not null,
  source_message_id        text not null,
  whatsapp_business_id     text not null,
  phone_number_id          text,
  source_id                text,
  source_type              text not null default 'unknown',
  ctwa_clid                text,
  ctwa_fingerprint         text,
  had_ctwa_clid            boolean not null default false,
  message_at               timestamptz not null,
  ad_id_snapshot           text,
  ad_name_snapshot         text,
  adset_id_snapshot        text,
  adset_name_snapshot      text,
  campaign_id_snapshot     text,
  campaign_name_snapshot   text,
  account_id_snapshot      text,
  enriched_at              timestamptz,
  redacted_at              timestamptz,
  created_at               timestamptz not null default now(),
  constraint meta_attributions_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete cascade,
  constraint meta_attributions_source_id_fkey
    foreign key (source_id) references public.meta_ad_assets(source_id) on delete restrict,
  constraint meta_attributions_source_type_check
    check (source_type in ('ad', 'post', 'unknown')),
  constraint meta_attributions_message_unique
    unique (whatsapp_business_id, source_message_id)
);

create unique index if not exists meta_attributions_ctwa_fingerprint_uidx
  on public.meta_attributions (ctwa_fingerprint)
  where ctwa_fingerprint is not null;
create index if not exists meta_attributions_lead_message_idx
  on public.meta_attributions (lead_id, message_at desc, created_at desc, id desc);
create index if not exists meta_attributions_campaign_snapshot_idx
  on public.meta_attributions (campaign_id_snapshot, message_at desc);

-- ---------------------------------------------------------------------------
-- Deals keep the attribution selected at opportunity creation forever.
-- ---------------------------------------------------------------------------
alter table public.deals
  add column if not exists meta_attribution_id uuid;

alter table public.deals
  drop constraint if exists deals_meta_attribution_id_fkey;
alter table public.deals
  add constraint deals_meta_attribution_id_fkey
  foreign key (meta_attribution_id)
  references public.meta_attributions(id)
  on delete set null;

-- The current trigger should already produce one source='lead' deal per lead.
-- Fail loudly instead of silently choosing one if production data diverged.
do $$
begin
  if exists (
    select 1
    from public.deals
    where source = 'lead'
    group by lead_id
    having count(*) > 1
  ) then
    raise exception 'meta tracking preflight: duplicate source=lead deals found';
  end if;
end;
$$;

create unique index if not exists deals_one_initial_per_lead_uidx
  on public.deals (lead_id)
  where source = 'lead';
create index if not exists deals_meta_attribution_id_idx
  on public.deals (meta_attribution_id);

-- Link chat conversations to their CRM lead without forcing a one-to-one
-- relationship: one lead can have conversations in multiple integrations.
alter table public.chat_conversations
  add column if not exists lead_id uuid;
alter table public.chat_conversations
  drop constraint if exists chat_conversations_lead_id_fkey;
alter table public.chat_conversations
  add constraint chat_conversations_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete set null;
create index if not exists chat_conversations_lead_id_idx
  on public.chat_conversations (lead_id);

-- ---------------------------------------------------------------------------
-- Immutable deal transition history used by reporting and conversion triggers.
-- ---------------------------------------------------------------------------
create table if not exists public.deal_stage_history (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null,
  lead_id      uuid not null,
  from_stage   text,
  to_stage     text not null,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint deal_stage_history_deal_id_fkey
    foreign key (deal_id) references public.deals(id) on delete cascade,
  constraint deal_stage_history_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete cascade
);

create index if not exists deal_stage_history_lead_stage_idx
  on public.deal_stage_history (lead_id, to_stage, occurred_at);
create index if not exists deal_stage_history_deal_idx
  on public.deal_stage_history (deal_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Durable Meta delivery outbox. It never stores ctwa_clid or request bodies.
-- ---------------------------------------------------------------------------
create table if not exists public.meta_conversion_outbox (
  id                    uuid primary key default gen_random_uuid(),
  event_key             text not null unique,
  event_id              text not null unique,
  event_name            text not null,
  attribution_id        uuid,
  lead_id               uuid not null,
  deal_id               uuid,
  event_time            timestamptz not null,
  status                text not null default 'pending',
  attempt_count         integer not null default 0,
  next_attempt_at       timestamptz not null default now(),
  lease_token           uuid,
  lease_owner           text,
  lease_expires_at      timestamptz,
  last_http_status      integer,
  last_error_category   text,
  last_error_code       text,
  last_error_message    text,
  response_summary      jsonb,
  sent_at               timestamptz,
  requeued_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint meta_conversion_outbox_event_name_check
    check (event_name in ('LeadSubmitted', 'QualifiedLead')),
  constraint meta_conversion_outbox_status_check
    check (status in ('pending', 'processing', 'retry', 'sent', 'dead_letter', 'skipped')),
  constraint meta_conversion_outbox_attribution_id_fkey
    foreign key (attribution_id) references public.meta_attributions(id) on delete set null,
  constraint meta_conversion_outbox_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete cascade,
  constraint meta_conversion_outbox_deal_id_fkey
    foreign key (deal_id) references public.deals(id) on delete cascade
);

create index if not exists meta_conversion_outbox_ready_idx
  on public.meta_conversion_outbox (status, next_attempt_at, created_at);
create index if not exists meta_conversion_outbox_lease_idx
  on public.meta_conversion_outbox (lease_expires_at)
  where status = 'processing';
create index if not exists meta_conversion_outbox_created_idx
  on public.meta_conversion_outbox (created_at desc);

insert into public.app_settings (key, value)
values (
  'meta_tracking',
  jsonb_build_object(
    'qualifiedStageKey', 'agendado',
    'attendedStageKey', 'compareceu',
    'patientStageKey', 'cliente'
  )
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Deal attribution and business event triggers.
-- ---------------------------------------------------------------------------
create or replace function public.assign_deal_meta_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.lead_id::text, 0));

  if new.meta_attribution_id is null then
    select a.id
      into new.meta_attribution_id
    from public.meta_attributions a
    where a.lead_id = new.lead_id
      and a.message_at <= coalesce(new.created_at, now())
    order by a.message_at desc, a.created_at desc, a.id desc
    limit 1;
  end if;

  if new.meta_attribution_id is not null
    and not exists (
      select 1
      from public.meta_attributions a
      where a.id = new.meta_attribution_id
        and a.lead_id = new.lead_id
    )
  then
    raise exception 'deal_meta_attribution_lead_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_deals_assign_meta_attribution on public.deals;
create trigger trg_deals_assign_meta_attribution
  before insert on public.deals
  for each row execute function public.assign_deal_meta_attribution();

create or replace function public.protect_deal_meta_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.meta_attribution_id is not null
    and not exists (
      select 1
      from public.meta_attributions a
      where a.id = new.meta_attribution_id
        and a.lead_id = new.lead_id
    )
  then
    raise exception 'deal_meta_attribution_lead_mismatch';
  end if;

  if old.meta_attribution_id is distinct from new.meta_attribution_id
    and coalesce(current_setting('app.meta_attribution_link', true), 'off') <> 'on'
  then
    raise exception 'deal_meta_attribution_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_deals_protect_meta_attribution on public.deals;
create trigger trg_deals_protect_meta_attribution
  before update of meta_attribution_id, lead_id on public.deals
  for each row execute function public.protect_deal_meta_attribution();

create or replace function public.record_deal_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qualified_stage text;
  v_attribution public.meta_attributions%rowtype;
  v_outbox_status text;
begin
  if tg_op = 'UPDATE' and old.stage is not distinct from new.stage then
    return new;
  end if;

  insert into public.deal_stage_history (deal_id, lead_id, from_stage, to_stage, occurred_at)
  values (
    new.id,
    new.lead_id,
    case when tg_op = 'UPDATE' then old.stage else null end,
    new.stage,
    now()
  );

  select coalesce(value->>'qualifiedStageKey', 'agendado')
    into v_qualified_stage
  from public.app_settings
  where key = 'meta_tracking';
  v_qualified_stage := coalesce(v_qualified_stage, 'agendado');

  if new.stage = v_qualified_stage then
    if new.meta_attribution_id is not null then
      select * into v_attribution
      from public.meta_attributions
      where id = new.meta_attribution_id;
    end if;

    v_outbox_status := case
      when v_attribution.id is not null and v_attribution.ctwa_clid is not null
        then 'pending'
      else 'skipped'
    end;

    insert into public.meta_conversion_outbox (
      event_key,
      event_id,
      event_name,
      attribution_id,
      lead_id,
      deal_id,
      event_time,
      status,
      last_error_category,
      last_error_message
    ) values (
      'qualified-lead:deal:' || new.id::text,
      'crm:meta:QualifiedLead:deal:' || new.id::text,
      'QualifiedLead',
      new.meta_attribution_id,
      new.lead_id,
      new.id,
      now(),
      v_outbox_status,
      case when v_outbox_status = 'skipped' then 'missing_attribution' end,
      case when v_outbox_status = 'skipped' then 'Deal sem click Meta elegível.' end
    )
    on conflict (event_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_deals_stage_history on public.deals;
create trigger trg_deals_stage_history
  after insert or update of stage on public.deals
  for each row execute function public.record_deal_stage_transition();

-- Backfill only transition history, never attribution or conversion events.
insert into public.deal_stage_history (deal_id, lead_id, from_stage, to_stage, occurred_at)
select d.id, d.lead_id, null, d.stage, d.created_at
from public.deals d
where not exists (
  select 1 from public.deal_stage_history h where h.deal_id = d.id
);

-- ---------------------------------------------------------------------------
-- Atomic webhook message ingestion.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_meta_webhook_message(
  p_integration_id uuid,
  p_phone text,
  p_normalized_phone text,
  p_contact_name text,
  p_external_id text,
  p_message_type text,
  p_content text,
  p_media_url text,
  p_media_mime_type text,
  p_message_at timestamptz,
  p_whatsapp_business_id text,
  p_phone_number_id text,
  p_source_id text,
  p_source_type text,
  p_ctwa_clid text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_attribution_id uuid;
  v_initial_deal_id uuid;
  v_is_new_lead boolean := false;
  v_inserted_message boolean := false;
  v_fingerprint text;
  v_source_type text;
begin
  if length(coalesce(p_normalized_phone, '')) < 10 then
    raise exception 'invalid_normalized_phone';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_normalized_phone, 0));

  select id into v_lead_id
  from public.leads
  where normalized_phone = p_normalized_phone;

  if v_lead_id is null then
    insert into public.leads (
      phone, normalized_phone, name, source, status, last_message_at, updated_at
    ) values (
      p_phone,
      p_normalized_phone,
      nullif(p_contact_name, ''),
      case when p_source_id is not null or p_ctwa_clid is not null then 'anuncio' else 'whatsapp' end,
      'novo',
      p_message_at,
      now()
    )
    returning id into v_lead_id;
    v_is_new_lead := true;
  else
    update public.leads
    set last_message_at = greatest(coalesce(last_message_at, p_message_at), p_message_at),
        updated_at = now(),
        name = case
          when name is null and nullif(p_contact_name, '') is not null then p_contact_name
          else name
        end
    where id = v_lead_id;
  end if;

  if p_integration_id is not null then
    insert into public.chat_conversations (
      integration_id,
      external_id,
      lead_id,
      contact_name,
      contact_phone,
      last_message_at,
      last_message_preview,
      updated_at
    ) values (
      p_integration_id,
      p_normalized_phone,
      v_lead_id,
      nullif(p_contact_name, ''),
      p_phone,
      p_message_at,
      left(coalesce(p_content, '[' || p_message_type || ']'), 120),
      now()
    )
    on conflict (integration_id, external_id) do update
    set lead_id = excluded.lead_id,
        contact_phone = excluded.contact_phone,
        contact_name = coalesce(public.chat_conversations.contact_name, excluded.contact_name),
        last_message_at = greatest(
          coalesce(public.chat_conversations.last_message_at, excluded.last_message_at),
          excluded.last_message_at
        ),
        last_message_preview = excluded.last_message_preview,
        updated_at = now()
    returning id into v_conversation_id;

    insert into public.chat_messages (
      conversation_id,
      external_id,
      direction,
      type,
      content,
      media_url,
      media_mime_type,
      delivery_status,
      created_at
    ) values (
      v_conversation_id,
      p_external_id,
      'inbound',
      p_message_type,
      p_content,
      p_media_url,
      p_media_mime_type,
      'delivered',
      p_message_at
    )
    on conflict (conversation_id, external_id) do nothing
    returning id into v_message_id;

    if v_message_id is not null then
      v_inserted_message := true;
      update public.chat_conversations
      set unread_count = unread_count + 1
      where id = v_conversation_id;
    else
      select id into v_message_id
      from public.chat_messages
      where conversation_id = v_conversation_id
        and external_id = p_external_id;
    end if;
  end if;

  if p_source_id is not null or p_ctwa_clid is not null then
    v_source_type := case
      when p_source_type in ('ad', 'post') then p_source_type
      else 'unknown'
    end;

    if p_source_id is not null then
      insert into public.meta_ad_assets (source_id, source_type)
      values (p_source_id, v_source_type)
      on conflict (source_id) do update
      set source_type = case
            when public.meta_ad_assets.source_type = 'unknown'
              then excluded.source_type
            else public.meta_ad_assets.source_type
          end,
          updated_at = now();
    end if;

    if nullif(p_ctwa_clid, '') is not null then
      v_fingerprint := encode(extensions.digest(p_ctwa_clid, 'sha256'), 'hex');
      select id into v_attribution_id
      from public.meta_attributions
      where ctwa_fingerprint = v_fingerprint;
    end if;

    if v_attribution_id is null then
      select id into v_attribution_id
      from public.meta_attributions
      where whatsapp_business_id = p_whatsapp_business_id
        and source_message_id = p_external_id;
    end if;

    if v_attribution_id is null then
      insert into public.meta_attributions (
        lead_id,
        source_message_id,
        whatsapp_business_id,
        phone_number_id,
        source_id,
        source_type,
        ctwa_clid,
        ctwa_fingerprint,
        had_ctwa_clid,
        message_at
      ) values (
        v_lead_id,
        p_external_id,
        p_whatsapp_business_id,
        p_phone_number_id,
        p_source_id,
        v_source_type,
        nullif(p_ctwa_clid, ''),
        v_fingerprint,
        nullif(p_ctwa_clid, '') is not null,
        p_message_at
      )
      returning id into v_attribution_id;
    end if;

    -- A reentrega pode conter um envelope mais completo. Só preenche lacunas;
    -- snapshots e dados já conhecidos continuam imutáveis.
    update public.meta_attributions
    set phone_number_id = coalesce(phone_number_id, p_phone_number_id),
        source_id = coalesce(source_id, p_source_id),
        source_type = case
          when source_type = 'unknown' then v_source_type
          else source_type
        end,
        ctwa_clid = case
          when redacted_at is null then coalesce(ctwa_clid, nullif(p_ctwa_clid, ''))
          else ctwa_clid
        end,
        ctwa_fingerprint = coalesce(ctwa_fingerprint, v_fingerprint),
        had_ctwa_clid = had_ctwa_clid or nullif(p_ctwa_clid, '') is not null
    where id = v_attribution_id;

    if v_is_new_lead then
      select id into v_initial_deal_id
      from public.deals
      where lead_id = v_lead_id and source = 'lead'
      order by created_at, id
      limit 1;

      if v_initial_deal_id is not null then
        perform set_config('app.meta_attribution_link', 'on', true);
        update public.deals
        set meta_attribution_id = v_attribution_id
        where id = v_initial_deal_id
          and meta_attribution_id is null;
        perform set_config('app.meta_attribution_link', 'off', true);
      end if;
    end if;

    insert into public.meta_conversion_outbox (
      event_key,
      event_id,
      event_name,
      attribution_id,
      lead_id,
      event_time,
      status,
      last_error_category,
      last_error_message
    ) values (
      'lead-submitted:attribution:' || v_attribution_id::text,
      'crm:meta:LeadSubmitted:attribution:' || v_attribution_id::text,
      'LeadSubmitted',
      v_attribution_id,
      v_lead_id,
      p_message_at,
      case when nullif(p_ctwa_clid, '') is not null then 'pending' else 'skipped' end,
      case when nullif(p_ctwa_clid, '') is null then 'missing_ctwa_clid' end,
      case when nullif(p_ctwa_clid, '') is null then 'Referral sem click ID elegível para CAPI.' end
    )
    on conflict (event_key) do nothing;

    if nullif(p_ctwa_clid, '') is not null then
      update public.meta_conversion_outbox
      set status = 'pending',
          next_attempt_at = now(),
          last_error_category = null,
          last_error_message = null,
          updated_at = now()
      where attribution_id = v_attribution_id
        and status = 'skipped'
        and exists (
          select 1
          from public.meta_attributions a
          where a.id = v_attribution_id
            and a.redacted_at is null
        );
    end if;
  end if;

  return jsonb_build_object(
    'leadId', v_lead_id,
    'conversationId', v_conversation_id,
    'messageId', v_message_id,
    'messageInserted', v_inserted_message,
    'attributionId', v_attribution_id,
    'initialDealId', v_initial_deal_id,
    'newLead', v_is_new_lead
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Lease-safe outbox operations.
-- ---------------------------------------------------------------------------
create or replace function public.claim_meta_conversion_outbox(
  p_owner text,
  p_limit integer default 50
)
returns table (
  id uuid,
  event_id text,
  event_name text,
  event_time timestamptz,
  attempt_count integer,
  created_at timestamptz,
  lease_token uuid,
  ctwa_clid text,
  whatsapp_business_id text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.meta_conversion_outbox o
  set status = 'dead_letter',
      last_error_category = 'retry_exhausted',
      last_error_message = 'Limite de tentativas ou idade excedido.',
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where o.status in ('pending', 'retry', 'processing')
    and (
      o.attempt_count >= 8
      or coalesce(o.requeued_at, o.created_at) <= now() - interval '72 hours'
    )
    and (o.status <> 'processing' or o.lease_expires_at < now());

  return query
  with ready as (
    select o.id
    from public.meta_conversion_outbox o
    where (
      (o.status in ('pending', 'retry') and o.next_attempt_at <= now())
      or (o.status = 'processing' and o.lease_expires_at < now())
    )
      and o.attempt_count < 8
      and coalesce(o.requeued_at, o.created_at) > now() - interval '72 hours'
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  ), claimed as (
    update public.meta_conversion_outbox o
    set status = 'processing',
        attempt_count = o.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_owner = p_owner,
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
    from ready
    where o.id = ready.id
    returning o.*
  )
  select
    c.id,
    c.event_id,
    c.event_name,
    c.event_time,
    c.attempt_count,
    c.created_at,
    c.lease_token,
    a.ctwa_clid,
    a.whatsapp_business_id
  from claimed c
  join public.meta_attributions a on a.id = c.attribution_id
  where a.ctwa_clid is not null;
end;
$$;

create or replace function public.apply_meta_ad_asset_enrichment(
  p_source_id text,
  p_ad_id text,
  p_ad_name text,
  p_adset_id text,
  p_adset_name text,
  p_campaign_id text,
  p_campaign_name text,
  p_account_id text,
  p_status text,
  p_last_error text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_status not in ('enriched', 'partial', 'retry', 'error') then
    raise exception 'invalid_asset_enrichment_status';
  end if;

  update public.meta_ad_assets
  set ad_id = coalesce(p_ad_id, ad_id),
      ad_name = coalesce(p_ad_name, ad_name),
      adset_id = coalesce(p_adset_id, adset_id),
      adset_name = coalesce(p_adset_name, adset_name),
      campaign_id = coalesce(p_campaign_id, campaign_id),
      campaign_name = coalesce(p_campaign_name, campaign_name),
      account_id = coalesce(p_account_id, account_id),
      enrichment_status = p_status,
      attempt_count = attempt_count + 1,
      next_attempt_at = case
        when p_status = 'retry' then now() + interval '30 minutes'
        else next_attempt_at
      end,
      last_error = left(p_last_error, 300),
      refreshed_at = case when p_status in ('enriched', 'partial') then now() else refreshed_at end,
      updated_at = now()
  where source_id = p_source_id;

  update public.meta_attributions
  set ad_id_snapshot = coalesce(ad_id_snapshot, p_ad_id),
      ad_name_snapshot = coalesce(ad_name_snapshot, p_ad_name),
      adset_id_snapshot = coalesce(adset_id_snapshot, p_adset_id),
      adset_name_snapshot = coalesce(adset_name_snapshot, p_adset_name),
      campaign_id_snapshot = coalesce(campaign_id_snapshot, p_campaign_id),
      campaign_name_snapshot = coalesce(campaign_name_snapshot, p_campaign_name),
      account_id_snapshot = coalesce(account_id_snapshot, p_account_id),
      enriched_at = case
        when p_status in ('enriched', 'partial') then coalesce(enriched_at, now())
        else enriched_at
      end
  where source_id = p_source_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.retry_meta_conversion_outbox(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.meta_conversion_outbox%rowtype;
  v_has_click boolean;
begin
  select * into v_row
  from public.meta_conversion_outbox
  where id = p_id
  for update;

  if not found then return 'not_found'; end if;
  if v_row.status <> 'dead_letter' then return 'conflict'; end if;

  select a.ctwa_clid is not null into v_has_click
  from public.meta_attributions a
  where a.id = v_row.attribution_id;

  if coalesce(v_has_click, false) = false then return 'ineligible'; end if;

  update public.meta_conversion_outbox
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = now(),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      last_error_category = null,
      last_error_code = null,
      last_error_message = null,
      requeued_at = now(),
      updated_at = now()
  where id = p_id;

  return 'requeued';
end;
$$;

create or replace function public.finish_meta_conversion_outbox_item(
  p_id uuid,
  p_lease_token uuid,
  p_status text,
  p_next_attempt_at timestamptz,
  p_http_status integer,
  p_error_category text,
  p_error_code text,
  p_error_message text,
  p_response_summary jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_status not in ('sent', 'retry', 'dead_letter') then
    raise exception 'invalid_outbox_finish_status';
  end if;

  update public.meta_conversion_outbox
  set status = p_status,
      next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
      last_http_status = p_http_status,
      last_error_category = p_error_category,
      last_error_code = p_error_code,
      last_error_message = left(p_error_message, 500),
      response_summary = p_response_summary,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_id
    and status = 'processing'
    and lease_token = p_lease_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.redact_expired_meta_attributions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.meta_attributions a
  set ctwa_clid = null,
      redacted_at = now()
  where a.ctwa_clid is not null
    and a.message_at < now() - interval '90 days'
    and not exists (
      select 1
      from public.meta_conversion_outbox o
      where o.attribution_id = a.id
        and o.status in ('pending', 'processing', 'retry')
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- New tracking data is backend-only. service_role bypasses RLS by design.
alter table public.meta_ad_assets enable row level security;
alter table public.meta_attributions enable row level security;
alter table public.deal_stage_history enable row level security;
alter table public.meta_conversion_outbox enable row level security;

revoke all on public.meta_ad_assets from anon, authenticated;
revoke all on public.meta_attributions from anon, authenticated;
revoke all on public.deal_stage_history from anon, authenticated;
revoke all on public.meta_conversion_outbox from anon, authenticated;

revoke all on function public.ingest_meta_webhook_message(
  uuid, text, text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.claim_meta_conversion_outbox(text, integer)
  from public, anon, authenticated;
revoke all on function public.finish_meta_conversion_outbox_item(
  uuid, uuid, text, timestamptz, integer, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.redact_expired_meta_attributions()
  from public, anon, authenticated;
revoke all on function public.apply_meta_ad_asset_enrichment(
  text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.retry_meta_conversion_outbox(uuid)
  from public, anon, authenticated;

grant execute on function public.ingest_meta_webhook_message(
  uuid, text, text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text
) to service_role;
grant execute on function public.claim_meta_conversion_outbox(text, integer)
  to service_role;
grant execute on function public.finish_meta_conversion_outbox_item(
  uuid, uuid, text, timestamptz, integer, text, text, text, jsonb
) to service_role;
grant execute on function public.redact_expired_meta_attributions()
  to service_role;
grant execute on function public.apply_meta_ad_asset_enrichment(
  text, text, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.retry_meta_conversion_outbox(uuid)
  to service_role;
