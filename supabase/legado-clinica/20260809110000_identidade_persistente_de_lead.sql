-- Identidade persistente de Lead/Pessoa.
--
-- `leads.id` continua sendo a pessoa canônica. Telefones observados viram
-- identidades exatas; conversas e oportunidades referenciam a pessoa, mas não
-- são a própria pessoa. A migration é aditiva, reexecutável e não faz merge
-- relaxado pelo nono dígito.

create extension if not exists pgcrypto;

alter table public.leads
  add column if not exists archived_at timestamptz;

-- Pessoa pode nascer fora do WhatsApp (ex.: contrato digitado só com nome).
-- `NULL` significa "identidade telefônica ainda desconhecida"; quando o
-- telefone chegar, a trigger abaixo cria o alias canônico. A unique existente
-- continua impedindo duplicidade entre telefones conhecidos.
alter table public.leads
  alter column normalized_phone drop not null;

alter table public.deals
  add column if not exists removed_at timestamptz;

alter table public.chat_conversations
  add column if not exists removed_at timestamptz;

create index if not exists leads_archived_at_idx
  on public.leads (archived_at)
  where archived_at is not null;

create index if not exists deals_active_lead_idx
  on public.deals (lead_id, created_at desc)
  where removed_at is null;

create index if not exists chat_conversations_removed_at_idx
  on public.chat_conversations (removed_at)
  where removed_at is not null;

create index if not exists chat_conversations_active_lead_idx
  on public.chat_conversations (lead_id, last_message_at desc)
  where removed_at is null;

create table if not exists public.lead_phone_identities (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null,
  normalized_phone text not null,
  match_key        text not null,
  source           text not null default 'legacy',
  provider         text,
  is_primary       boolean not null default false,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lead_phone_identities_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete restrict,
  constraint lead_phone_identities_normalized_phone_key
    unique (normalized_phone),
  constraint lead_phone_identities_phone_format_check
    check (normalized_phone ~ '^[0-9]{10,15}$'),
  constraint lead_phone_identities_match_key_format_check
    check (match_key ~ '^[0-9]{10,15}$')
);

create unique index if not exists lead_phone_identities_primary_lead_uidx
  on public.lead_phone_identities (lead_id)
  where is_primary;

create index if not exists lead_phone_identities_match_key_idx
  on public.lead_phone_identities (match_key);

create index if not exists lead_phone_identities_lead_id_idx
  on public.lead_phone_identities (lead_id, created_at);

create table if not exists public.lead_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null,
  event_type  text not null,
  entity_type text,
  entity_id   uuid,
  event_key   text,
  metadata    jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint lead_events_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete restrict,
  constraint lead_events_event_type_not_blank
    check (btrim(event_type) <> ''),
  constraint lead_events_event_key_not_blank
    check (event_key is null or btrim(event_key) <> '')
);

create unique index if not exists lead_events_event_key_uidx
  on public.lead_events (event_key)
  where event_key is not null;

create index if not exists lead_events_lead_occurred_idx
  on public.lead_events (lead_id, occurred_at desc, id desc);

create index if not exists lead_events_entity_idx
  on public.lead_events (entity_type, entity_id)
  where entity_id is not null;

alter table public.lead_phone_identities enable row level security;
alter table public.lead_events enable row level security;

revoke all on public.lead_phone_identities from anon, authenticated;
revoke all on public.lead_events from anon, authenticated;
revoke all on public.lead_phone_identities from service_role;
revoke all on public.lead_events from service_role;
grant select, insert, update on public.lead_phone_identities to service_role;
grant select, insert on public.lead_events to service_role;

-- Mesma normalização usada por `src/lib/formatters/phone.ts`: remove símbolos e
-- o DDI 55 somente quando o valor tem mais de 11 dígitos. Não aplica nono
-- dígito automaticamente; essa variação é apenas uma chave de candidatos.
create or replace function public.normalize_lead_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) > 11
     and left(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 2) = '55'
      then substr(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 3)
    else regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  end;
$$;

create or replace function public.lead_phone_match_key(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when length(public.normalize_lead_phone(p_phone)) = 11
     and substr(public.normalize_lead_phone(p_phone), 3, 1) = '9'
      then substr(public.normalize_lead_phone(p_phone), 1, 2)
        || substr(public.normalize_lead_phone(p_phone), 4)
    else public.normalize_lead_phone(p_phone)
  end;
$$;

revoke execute on function public.normalize_lead_phone(text)
  from public, anon, authenticated;
revoke execute on function public.lead_phone_match_key(text)
  from public, anon, authenticated;
grant execute on function public.normalize_lead_phone(text) to service_role;
grant execute on function public.lead_phone_match_key(text) to service_role;

-- Impede que um update de telefone roube uma identidade que já pertence a
-- outra pessoa. O telefone anterior continua como alias para reconhecer o
-- cliente quando ele voltar pelo identificador antigo.
create or replace function public.sync_lead_primary_phone_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized text;
  v_identity_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.normalized_phone is not distinct from new.normalized_phone then
    return new;
  end if;

  if new.normalized_phone is null then
    return new;
  end if;

  v_normalized := public.normalize_lead_phone(new.normalized_phone);
  if v_normalized !~ '^[0-9]{10,15}$' then
    raise exception 'invalid_normalized_phone'
      using errcode = '22023';
  end if;

  update public.lead_phone_identities
  set is_primary = false,
      updated_at = now()
  where lead_id = new.id
    and normalized_phone <> v_normalized
    and is_primary;

  insert into public.lead_phone_identities (
    lead_id,
    normalized_phone,
    match_key,
    source,
    is_primary,
    verified_at
  ) values (
    new.id,
    v_normalized,
    public.lead_phone_match_key(v_normalized),
    coalesce(new.source, 'legacy'),
    true,
    null
  )
  on conflict (normalized_phone) do update
  set is_primary = true,
      updated_at = now()
  where public.lead_phone_identities.lead_id = excluded.lead_id
  returning id into v_identity_id;

  if v_identity_id is null then
    raise exception 'lead_phone_identity_conflict'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke execute on function public.sync_lead_primary_phone_identity()
  from public, anon, authenticated;

drop trigger if exists trg_leads_sync_primary_phone_identity on public.leads;
create trigger trg_leads_sync_primary_phone_identity
  after insert or update of normalized_phone on public.leads
  for each row execute function public.sync_lead_primary_phone_identity();

-- Telefones já existentes viram identidades primárias exatas. O único valor
-- legado inválido permanece sem alias para revisão; ele não é fabricado nem
-- mesclado.
insert into public.lead_phone_identities (
  lead_id,
  normalized_phone,
  match_key,
  source,
  is_primary,
  verified_at,
  created_at,
  updated_at
)
select
  l.id,
  public.normalize_lead_phone(l.normalized_phone),
  public.lead_phone_match_key(l.normalized_phone),
  coalesce(l.source, 'legacy'),
  true,
  null,
  l.created_at,
  l.updated_at
from public.leads l
where public.normalize_lead_phone(l.normalized_phone) ~ '^[0-9]{10,15}$'
on conflict (normalized_phone) do nothing;

-- A trigger histórica continua protegendo inserts legados, mas o resolvedor
-- consegue separar criação de pessoa e criação de oportunidade por uma flag
-- transacional. O comportamento padrão fora do resolvedor não muda.
create or replace function public.create_initial_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.skip_initial_deal', true), 'off') <> 'on'
     and coalesce(new.imported, false) = false
     and not exists (
       select 1
       from public.deals d
       where d.lead_id = new.id
         and d.removed_at is null
     ) then
    insert into public.deals (lead_id, stage, tipo_ensaio, valor, source)
    values (new.id, new.status, new.tipo_ensaio, new.valor_estimado, 'lead')
    on conflict (lead_id) where source = 'lead' do update
      set removed_at = null,
          updated_at = now();
  end if;
  return new;
end;
$$;

revoke execute on function public.create_initial_deal()
  from public, anon, authenticated;

-- Fonte única de resolução. Igualdade exata vence; `match_key` nunca seleciona
-- nem mescla pessoa. O lock transacional e a unique do alias cobrem eventos
-- concorrentes do mesmo telefone.
create or replace function public.resolve_lead_identity(
  p_phone text,
  p_name text default null,
  p_source text default 'whatsapp',
  p_create_initial_deal boolean default false,
  p_last_interaction_at timestamptz default null,
  p_reactivate boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized text;
  v_lead_id uuid;
  v_created boolean := false;
  v_deal_id uuid;
begin
  v_normalized := public.normalize_lead_phone(p_phone);
  if v_normalized is null or v_normalized !~ '^[0-9]{10,15}$' then
    raise exception 'invalid_normalized_phone'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_normalized, 0)
  );

  select i.lead_id
    into v_lead_id
  from public.lead_phone_identities i
  where i.normalized_phone = v_normalized;

  -- Compatibilidade durante rollout: uma linha antiga pode existir antes do
  -- backfill de identidades chegar à mesma transação.
  if v_lead_id is null then
    select l.id
      into v_lead_id
    from public.leads l
    where l.normalized_phone = v_normalized;
  end if;

  if v_lead_id is null then
    perform pg_catalog.set_config('app.skip_initial_deal', 'on', true);

    insert into public.leads (
      phone,
      normalized_phone,
      name,
      source,
      status,
      last_message_at,
      archived_at,
      updated_at
    ) values (
      p_phone,
      v_normalized,
      nullif(btrim(p_name), ''),
      coalesce(nullif(btrim(p_source), ''), 'whatsapp'),
      'novo',
      p_last_interaction_at,
      null,
      now()
    )
    returning id into v_lead_id;

    perform pg_catalog.set_config('app.skip_initial_deal', 'off', true);
    v_created := true;
  else
    update public.leads
    set phone = coalesce(phone, p_phone),
        name = case
          when name is null then nullif(btrim(p_name), '')
          else name
        end,
        last_message_at = case
          when p_last_interaction_at is null then last_message_at
          else greatest(coalesce(last_message_at, p_last_interaction_at), p_last_interaction_at)
        end,
        archived_at = case when p_reactivate then null else archived_at end,
        updated_at = now()
    where id = v_lead_id;
  end if;

  insert into public.lead_phone_identities (
    lead_id,
    normalized_phone,
    match_key,
    source,
    is_primary,
    verified_at
  ) values (
    v_lead_id,
    v_normalized,
    public.lead_phone_match_key(v_normalized),
    coalesce(nullif(btrim(p_source), ''), 'whatsapp'),
    v_created,
    null
  )
  on conflict (normalized_phone) do update
  set updated_at = now()
  where public.lead_phone_identities.lead_id = excluded.lead_id;

  if not exists (
    select 1
    from public.lead_phone_identities i
    where i.normalized_phone = v_normalized
      and i.lead_id = v_lead_id
  ) then
    raise exception 'lead_phone_identity_conflict'
      using errcode = '23505';
  end if;

  if p_create_initial_deal
     and not exists (
       select 1
       from public.deals d
       where d.lead_id = v_lead_id
         and d.removed_at is null
     ) then
    insert into public.deals (lead_id, stage, tipo_ensaio, valor, source)
    select l.id, l.status, l.tipo_ensaio, l.valor_estimado, 'lead'
    from public.leads l
    where l.id = v_lead_id
    on conflict (lead_id) where source = 'lead' do update
      set removed_at = null,
          updated_at = now()
    returning id into v_deal_id;
  end if;

  return jsonb_build_object(
    'leadId', v_lead_id,
    'normalizedPhone', v_normalized,
    'created', v_created,
    'initialDealId', v_deal_id
  );
end;
$$;

revoke execute on function public.resolve_lead_identity(
  text, text, text, boolean, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.resolve_lead_identity(
  text, text, text, boolean, timestamptz, boolean
) to service_role;

-- `leads.status` é projeção do funil. Uma edição pela pessoa pode mover o card
-- somente quando existe no máximo uma oportunidade ativa; com várias, escolher
-- silenciosamente corromperia o contexto comercial.
drop function if exists public.set_lead_status_from_single_deal(
  uuid, text, timestamptz
);

create or replace function public.set_lead_status_from_single_deal(
  p_lead_id uuid,
  p_status text,
  p_occurred_at timestamptz default now(),
  p_lead_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal_id uuid;
  v_deal_count integer;
  v_stage_type text;
  v_stage_exists boolean := false;
begin
  if nullif(btrim(p_status), '') is null then
    raise exception 'invalid_lead_status'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_lead_patch, '{}'::jsonb)) <> 'object'
     or coalesce(p_lead_patch, '{}'::jsonb) - array[
       'name',
       'phone',
       'normalized_phone',
       'instagram_user',
       'email',
       'source',
       'tipo_ensaio',
       'agencia_nome',
       'modelo_nome',
       'interesse',
       'valor_estimado',
       'is_recorrente',
       'historico_compras',
       'imported',
       'memoria_contexto',
       'notes',
       'last_message_at',
       'agendado_at'
     ] <> '{}'::jsonb then
    raise exception 'invalid_lead_patch'
      using errcode = '22023';
  end if;

  perform 1 from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead_not_found'
      using errcode = 'P0002';
  end if;

  select c.stage_type, true
    into v_stage_type, v_stage_exists
  from public.board_columns c
  where c.key = p_status;

  if not v_stage_exists then
    raise exception 'invalid_lead_status'
      using errcode = '22023';
  end if;

  select count(*)
    into v_deal_count
  from public.deals d
  where d.lead_id = p_lead_id
    and d.removed_at is null;

  if v_deal_count > 1 then
    raise exception 'multiple_active_deals_requires_deal_id'
      using errcode = '21000';
  end if;

  if v_deal_count = 1 then
    select d.id
      into v_deal_id
    from public.deals d
    where d.lead_id = p_lead_id
      and d.removed_at is null;
  end if;

  -- Carimba a pessoa antes de mover o card. A trigger de projeção do card usa
  -- `coalesce` e, assim, preserva a data de negócio recebida aqui (por exemplo,
  -- a data agendada) em vez de substituí-la pelo horário da query. O perfil
  -- opcional é aplicado no mesmo UPDATE: conflito de identidade, etapa ambígua
  -- ou falha no card fazem a transação inteira voltar.
  update public.leads
  set name = case
        when p_lead_patch ? 'name' then p_lead_patch ->> 'name'
        else name
      end,
      phone = case
        when p_lead_patch ? 'phone' then p_lead_patch ->> 'phone'
        else phone
      end,
      normalized_phone = case
        when p_lead_patch ? 'normalized_phone'
          then nullif(p_lead_patch ->> 'normalized_phone', '')
        else normalized_phone
      end,
      instagram_user = case
        when p_lead_patch ? 'instagram_user' then p_lead_patch ->> 'instagram_user'
        else instagram_user
      end,
      email = case
        when p_lead_patch ? 'email' then p_lead_patch ->> 'email'
        else email
      end,
      source = case
        when p_lead_patch ? 'source' then p_lead_patch ->> 'source'
        else source
      end,
      tipo_ensaio = case
        when p_lead_patch ? 'tipo_ensaio' then p_lead_patch ->> 'tipo_ensaio'
        else tipo_ensaio
      end,
      agencia_nome = case
        when p_lead_patch ? 'agencia_nome' then p_lead_patch ->> 'agencia_nome'
        else agencia_nome
      end,
      modelo_nome = case
        when p_lead_patch ? 'modelo_nome' then p_lead_patch ->> 'modelo_nome'
        else modelo_nome
      end,
      interesse = case
        when p_lead_patch ? 'interesse' then p_lead_patch ->> 'interesse'
        else interesse
      end,
      valor_estimado = case
        when p_lead_patch ? 'valor_estimado'
          then (p_lead_patch ->> 'valor_estimado')::numeric
        else valor_estimado
      end,
      is_recorrente = case
        when p_lead_patch ? 'is_recorrente'
          then (p_lead_patch ->> 'is_recorrente')::boolean
        else is_recorrente
      end,
      historico_compras = case
        when p_lead_patch ? 'historico_compras' then p_lead_patch ->> 'historico_compras'
        else historico_compras
      end,
      imported = case
        when p_lead_patch ? 'imported'
          then (p_lead_patch ->> 'imported')::boolean
        else imported
      end,
      memoria_contexto = case
        when p_lead_patch ? 'memoria_contexto' then p_lead_patch ->> 'memoria_contexto'
        else memoria_contexto
      end,
      notes = case
        when p_lead_patch ? 'notes' then p_lead_patch ->> 'notes'
        else notes
      end,
      last_message_at = case
        when p_lead_patch ? 'last_message_at' then greatest(
          coalesce(last_message_at, (p_lead_patch ->> 'last_message_at')::timestamptz),
          (p_lead_patch ->> 'last_message_at')::timestamptz
        )
        else last_message_at
      end,
      status = p_status,
      qualificado_at = case
        when p_status = 'qualificado' then coalesce(qualificado_at, p_occurred_at)
        else qualificado_at
      end,
      agendado_at = case
        when p_lead_patch ? 'agendado_at'
          then (p_lead_patch ->> 'agendado_at')::timestamptz
        when p_status = 'agendado' then coalesce(agendado_at, p_occurred_at)
        else agendado_at
      end,
      compareceu_at = case
        when p_status = 'compareceu' then coalesce(compareceu_at, p_occurred_at)
        else compareceu_at
      end,
      cliente_at = case
        when p_status = 'cliente' then coalesce(cliente_at, p_occurred_at)
        else cliente_at
      end,
      archived_at = null,
      updated_at = now()
  where id = p_lead_id;

  if v_deal_id is not null then
    update public.deals
    set stage = p_status,
        won_at = case when v_stage_type = 'won' then p_occurred_at else null end,
        lost_at = case when v_stage_type = 'lost' then p_occurred_at else null end,
        updated_at = now()
    where id = v_deal_id;
  end if;

  return jsonb_build_object('leadId', p_lead_id, 'dealId', v_deal_id, 'status', p_status);
end;
$$;

revoke execute on function public.set_lead_status_from_single_deal(
  uuid, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.set_lead_status_from_single_deal(
  uuid, text, timestamptz, jsonb
) to service_role;

-- O card é a verdade comercial e `leads.status` é sua projeção. Fazer isso em
-- trigger elimina a janela entre duas chamadas HTTP e cobre escritores legados
-- que atualizem `deals` diretamente.
create or replace function public.project_lead_status_from_deals(
  p_lead_id uuid,
  p_occurred_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_event_at timestamptz;
begin
  select c.key
    into v_status
  from public.deals d
  join public.board_columns c on c.key = d.stage
  where d.lead_id = p_lead_id
    and d.removed_at is null
  order by
    case c.stage_type when 'won' then 2 when 'lost' then 0 else 1 end desc,
    c.position desc
  limit 1;

  -- Sem oportunidade ativa, a pessoa mantém o último estado conhecido. Isso
  -- preserva contexto de quem já foi cliente sem fabricar uma nova etapa.
  if v_status is null then
    return null;
  end if;

  v_event_at := coalesce(
    p_occurred_at,
    (
      select min(h.occurred_at)
      from public.deal_stage_history h
      where h.lead_id = p_lead_id
        and h.to_stage = v_status
    ),
    now()
  );

  update public.leads
  set status = v_status,
      qualificado_at = case
        when v_status = 'qualificado' then coalesce(qualificado_at, v_event_at)
        else qualificado_at
      end,
      agendado_at = case
        when v_status = 'agendado' then coalesce(agendado_at, v_event_at)
        else agendado_at
      end,
      compareceu_at = case
        when v_status = 'compareceu' then coalesce(compareceu_at, v_event_at)
        else compareceu_at
      end,
      cliente_at = case
        when v_status = 'cliente' then coalesce(cliente_at, v_event_at)
        else cliente_at
      end,
      updated_at = case
        when status is distinct from v_status then now()
        else updated_at
      end
  where id = p_lead_id;

  return v_status;
end;
$$;

create or replace function public.project_deal_lead_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.lead_id is distinct from new.lead_id then
    perform public.project_lead_status_from_deals(old.lead_id, now());
  end if;
  perform public.project_lead_status_from_deals(new.lead_id, now());
  return new;
end;
$$;

revoke execute on function public.project_lead_status_from_deals(uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.project_deal_lead_status()
  from public, anon, authenticated;

drop trigger if exists trg_deals_project_lead_status on public.deals;
create trigger trg_deals_project_lead_status
  after insert or update of stage, removed_at, lead_id
  on public.deals
  for each row execute function public.project_deal_lead_status();

-- Configurar o board também pode mudar qual dos vários cards representa a
-- pessoa. Recalcula a projeção sem fabricar uma nova interação comercial.
create or replace function public.reproject_leads_from_board_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
begin
  for v_lead in
    select distinct d.lead_id
    from public.deals d
    where d.removed_at is null
  loop
    perform public.project_lead_status_from_deals(v_lead.lead_id, null);
  end loop;
  return new;
end;
$$;

-- A coluna não é a identidade do card. Ao removê-la, cards ativos vão para a
-- entrada padrão dentro da mesma transação e o trigger de histórico registra
-- a movimentação; cards já removidos preservam o snapshot histórico.
create or replace function public.reassign_deals_before_board_column_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.key = 'novo' then
    raise exception 'cannot_delete_default_board_column'
      using errcode = '23514';
  end if;

  update public.deals
  set stage = 'novo',
      won_at = null,
      lost_at = null,
      updated_at = now()
  where stage = old.key
    and removed_at is null;

  update public.leads l
  set status = 'novo',
      updated_at = now()
  where l.status = old.key
    and not exists (
      select 1
      from public.deals d
      where d.lead_id = l.id
        and d.removed_at is null
    );

  return old;
end;
$$;

revoke execute on function public.reproject_leads_from_board_change()
  from public, anon, authenticated;
revoke execute on function public.reassign_deals_before_board_column_delete()
  from public, anon, authenticated;

drop trigger if exists trg_board_columns_reproject_leads
  on public.board_columns;
create trigger trg_board_columns_reproject_leads
  after update of position, stage_type
  on public.board_columns
  for each row execute function public.reproject_leads_from_board_change();

drop trigger if exists trg_board_columns_reassign_deals
  on public.board_columns;
create trigger trg_board_columns_reassign_deals
  before delete on public.board_columns
  for each row execute function public.reassign_deals_before_board_column_delete();

-- Repara qualquer divergência criada desde o último backfill sem reescrever
-- marcos legítimos: `NULL` força a data histórica de `deal_stage_history`.
do $$
declare
  v_lead record;
begin
  for v_lead in
    select distinct d.lead_id
    from public.deals d
    where d.removed_at is null
  loop
    perform public.project_lead_status_from_deals(v_lead.lead_id, null);
  end loop;
end;
$$;

-- Compatibilidade de rollout: mesmo o app anterior, que ainda inseria conversa
-- sem `lead_id`, passa pelo resolvedor antes de a constraint NOT NULL agir.
create or replace function public.ensure_chat_conversation_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if new.lead_id is not null then
    return new;
  end if;

  v_result := public.resolve_lead_identity(
    coalesce(new.contact_phone, new.external_id),
    new.contact_name,
    'whatsapp',
    false,
    null,
    false
  );
  new.lead_id := (v_result ->> 'leadId')::uuid;
  return new;
end;
$$;

revoke execute on function public.ensure_chat_conversation_lead()
  from public, anon, authenticated;

drop trigger if exists trg_chat_conversations_ensure_lead
  on public.chat_conversations;
create trigger trg_chat_conversations_ensure_lead
  before insert or update of lead_id, contact_phone, external_id
  on public.chat_conversations
  for each row execute function public.ensure_chat_conversation_lead();

-- A conversa mantém o snapshot original do provedor em `metadata`, enquanto os
-- campos exibidos acompanham a pessoa canônica. Assim uma edição em `/leads`
-- aparece no Chat via Realtime sem transformar o snapshot em outra identidade.
create or replace function public.sync_conversation_canonical_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_phone text;
begin
  select l.name, l.phone
    into v_name, v_phone
  from public.leads l
  where l.id = new.lead_id;

  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'providerContactName', coalesce(
        new.metadata ->> 'providerContactName',
        new.contact_name
      ),
      'providerContactPhone', coalesce(
        new.metadata ->> 'providerContactPhone',
        new.contact_phone
      )
    ));
  new.contact_name := coalesce(v_name, new.contact_name);
  new.contact_phone := coalesce(v_phone, new.contact_phone);
  return new;
end;
$$;

create or replace function public.propagate_lead_contact_to_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.name is not distinct from new.name
     and old.phone is not distinct from new.phone then
    return new;
  end if;

  update public.chat_conversations
  set contact_name = coalesce(new.name, contact_name),
      contact_phone = coalesce(new.phone, contact_phone),
      updated_at = now()
  where lead_id = new.id;
  return new;
end;
$$;

revoke execute on function public.sync_conversation_canonical_contact()
  from public, anon, authenticated;
revoke execute on function public.propagate_lead_contact_to_conversations()
  from public, anon, authenticated;

drop trigger if exists trg_chat_conversations_sync_canonical_contact
  on public.chat_conversations;
create trigger trg_chat_conversations_sync_canonical_contact
  before insert or update of lead_id, contact_name, contact_phone
  on public.chat_conversations
  for each row execute function public.sync_conversation_canonical_contact();

drop trigger if exists trg_leads_propagate_contact
  on public.leads;
create trigger trg_leads_propagate_contact
  after update of name, phone on public.leads
  for each row execute function public.propagate_lead_contact_to_conversations();

-- Cria as pessoas mínimas das conversas antigas ainda sem correspondência
-- exata. Não cria oportunidade para conversa somente de saída.
do $$
declare
  v_conversation record;
begin
  for v_conversation in
    select distinct on (public.normalize_lead_phone(coalesce(c.contact_phone, c.external_id)))
      coalesce(c.contact_phone, c.external_id) as phone,
      c.contact_name,
      c.last_message_at
    from public.chat_conversations c
    where public.normalize_lead_phone(coalesce(c.contact_phone, c.external_id))
      ~ '^[0-9]{10,15}$'
      and not exists (
        select 1
        from public.lead_phone_identities i
        where i.normalized_phone = public.normalize_lead_phone(
          coalesce(c.contact_phone, c.external_id)
        )
      )
    order by
      public.normalize_lead_phone(coalesce(c.contact_phone, c.external_id)),
      c.last_message_at desc nulls last,
      c.id
  loop
    perform public.resolve_lead_identity(
      v_conversation.phone,
      v_conversation.contact_name,
      'whatsapp',
      false,
      v_conversation.last_message_at,
      false
    );
  end loop;
end;
$$;

update public.chat_conversations c
set lead_id = i.lead_id,
    updated_at = now()
from public.lead_phone_identities i
where c.lead_id is null
  and i.normalized_phone = public.normalize_lead_phone(
    coalesce(c.contact_phone, c.external_id)
  );

do $$
begin
  if exists (
    select 1
    from public.chat_conversations c
    where c.lead_id is null
  ) then
    raise exception 'conversation_without_resolvable_lead';
  end if;
end;
$$;

alter table public.chat_conversations
  alter column lead_id set not null;

alter table public.chat_conversations
  drop constraint if exists chat_conversations_lead_id_fkey;
alter table public.chat_conversations
  add constraint chat_conversations_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete restrict;

alter table public.deals
  drop constraint if exists deals_lead_id_fkey;
alter table public.deals
  add constraint deals_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete restrict;

alter table public.deal_stage_history
  drop constraint if exists deal_stage_history_deal_id_fkey;
alter table public.deal_stage_history
  add constraint deal_stage_history_deal_id_fkey
  foreign key (deal_id) references public.deals(id) on delete restrict;

-- Um inbound antigo sem oportunidade ganha exatamente uma. Outbound-only
-- continua apenas como pessoa/conversa.
insert into public.deals (lead_id, stage, tipo_ensaio, valor, source)
select l.id, l.status, l.tipo_ensaio, l.valor_estimado, 'lead'
from public.leads l
where not exists (
    select 1 from public.deals d where d.lead_id = l.id and d.removed_at is null
  )
  and exists (
    select 1
    from public.chat_conversations c
    join public.chat_messages m on m.conversation_id = c.id
    where c.lead_id = l.id
      and m.direction = 'inbound'
  )
on conflict (lead_id) where source = 'lead' do update
  set removed_at = null,
      updated_at = now();

-- O INSERT real de mensagem é a autoridade da interação. Isso evita que retry
-- de webhook reative pessoa/oportunidade ou avance `last_message_at`. Inbound
-- cria/restaura a oportunidade; outbound só registra a interação.
create or replace function public.ensure_inbound_lead_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
  v_lead_archived_at timestamptz;
begin
  select c.lead_id, l.archived_at
    into v_lead_id, v_lead_archived_at
  from public.chat_conversations c
  join public.leads l on l.id = c.lead_id
  where c.id = new.conversation_id;

  if v_lead_id is null then
    return new;
  end if;

  update public.leads
  set last_message_at = greatest(
        coalesce(last_message_at, new.created_at),
        new.created_at
      ),
      archived_at = case
        when new.direction = 'inbound'
         and (
           v_lead_archived_at is null
           or new.created_at > v_lead_archived_at
         ) then null
        else archived_at
      end,
      updated_at = now()
  where id = v_lead_id;

  if new.direction = 'inbound'
     and (
       v_lead_archived_at is null
       or new.created_at > v_lead_archived_at
     )
     and not exists (
       select 1
       from public.deals d
       where d.lead_id = v_lead_id
         and d.removed_at is null
     ) then
    insert into public.deals (lead_id, stage, tipo_ensaio, valor, source)
    select l.id, l.status, l.tipo_ensaio, l.valor_estimado, 'lead'
    from public.leads l
    where l.id = v_lead_id
    on conflict (lead_id) where source = 'lead' do update
      set removed_at = null,
          updated_at = now()
      where public.deals.removed_at is null
         or new.created_at > public.deals.removed_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.ensure_inbound_lead_deal()
  from public, anon, authenticated;

drop trigger if exists trg_chat_messages_ensure_inbound_deal
  on public.chat_messages;
create trigger trg_chat_messages_ensure_inbound_deal
  after insert on public.chat_messages
  for each row execute function public.ensure_inbound_lead_deal();

-- Criar/restaurar uma oportunidade é atividade atual da pessoa. Centralizar
-- esta reativação no banco cobre UI, API de integração e automações antigas.
create or replace function public.reactivate_lead_from_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.removed_at is null then
    update public.leads
    set archived_at = null,
        updated_at = now()
    where id = new.lead_id
      and archived_at is not null;
  end if;
  return new;
end;
$$;

revoke execute on function public.reactivate_lead_from_deal()
  from public, anon, authenticated;

drop trigger if exists trg_deals_reactivate_lead on public.deals;
create trigger trg_deals_reactivate_lead
  after insert or update of removed_at on public.deals
  for each row execute function public.reactivate_lead_from_deal();

-- Eventos transversais são append-only e não duplicam o conteúdo especializado
-- de mensagens, etapas ou financeiro.
create or replace function public.record_lead_row_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'lead.created';
  elsif old.archived_at is distinct from new.archived_at then
    v_event_type := case
      when new.archived_at is null then 'lead.reactivated'
      else 'lead.archived'
    end;
  else
    return new;
  end if;

  insert into public.lead_events (
    lead_id, event_type, entity_type, entity_id, event_key, occurred_at
  ) values (
    new.id,
    v_event_type,
    'lead',
    new.id,
    case when tg_op = 'INSERT' then 'lead.created:' || new.id::text end,
    case when tg_op = 'INSERT' then new.created_at else now() end
  )
  on conflict (event_key) where event_key is not null do nothing;

  return new;
end;
$$;

create or replace function public.record_lead_identity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_events (
    lead_id, event_type, entity_type, entity_id, event_key, occurred_at
  ) values (
    new.lead_id,
    'identity.added',
    'lead_phone_identity',
    new.id,
    'identity.added:' || new.id::text,
    new.created_at
  )
  on conflict (event_key) where event_key is not null do nothing;
  return new;
end;
$$;

create or replace function public.record_conversation_lead_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'conversation.started';
  elsif old.removed_at is distinct from new.removed_at then
    v_event_type := case
      when new.removed_at is null then 'conversation.restored'
      else 'conversation.removed'
    end;
  elsif old.archived_at is distinct from new.archived_at then
    v_event_type := case
      when new.archived_at is null then 'conversation.unarchived'
      else 'conversation.archived'
    end;
  else
    return new;
  end if;

  insert into public.lead_events (
    lead_id, event_type, entity_type, entity_id, event_key, occurred_at
  ) values (
    new.lead_id,
    v_event_type,
    'conversation',
    new.id,
    case when tg_op = 'INSERT' then 'conversation.started:' || new.id::text end,
    case when tg_op = 'INSERT' then new.created_at else now() end
  )
  on conflict (event_key) where event_key is not null do nothing;
  return new;
end;
$$;

create or replace function public.record_deal_lead_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'deal.created';
  elsif old.removed_at is distinct from new.removed_at then
    v_event_type := case
      when new.removed_at is null then 'deal.restored'
      else 'deal.removed'
    end;
  else
    return new;
  end if;

  insert into public.lead_events (
    lead_id, event_type, entity_type, entity_id, event_key, occurred_at
  ) values (
    new.lead_id,
    v_event_type,
    'deal',
    new.id,
    case when tg_op = 'INSERT' then 'deal.created:' || new.id::text end,
    case when tg_op = 'INSERT' then new.created_at else now() end
  )
  on conflict (event_key) where event_key is not null do nothing;
  return new;
end;
$$;

revoke execute on function public.record_lead_row_event()
  from public, anon, authenticated;
revoke execute on function public.record_lead_identity_event()
  from public, anon, authenticated;
revoke execute on function public.record_conversation_lead_event()
  from public, anon, authenticated;
revoke execute on function public.record_deal_lead_event()
  from public, anon, authenticated;

drop trigger if exists trg_leads_record_event on public.leads;
create trigger trg_leads_record_event
  after insert or update of archived_at on public.leads
  for each row execute function public.record_lead_row_event();

drop trigger if exists trg_lead_phone_identities_record_event
  on public.lead_phone_identities;
create trigger trg_lead_phone_identities_record_event
  after insert on public.lead_phone_identities
  for each row execute function public.record_lead_identity_event();

drop trigger if exists trg_chat_conversations_record_lead_event
  on public.chat_conversations;
create trigger trg_chat_conversations_record_lead_event
  after insert or update of removed_at, archived_at on public.chat_conversations
  for each row execute function public.record_conversation_lead_event();

drop trigger if exists trg_deals_record_lead_event on public.deals;
create trigger trg_deals_record_lead_event
  after insert or update of removed_at on public.deals
  for each row execute function public.record_deal_lead_event();

-- Backfill dos marcos que já existem. Não copia corpo de mensagem, telefone,
-- valor financeiro nem dado de campanha.
insert into public.lead_events (
  lead_id, event_type, entity_type, entity_id, event_key, occurred_at
)
select l.id, 'lead.created', 'lead', l.id, 'lead.created:' || l.id::text, l.created_at
from public.leads l
on conflict (event_key) where event_key is not null do nothing;

insert into public.lead_events (
  lead_id, event_type, entity_type, entity_id, event_key, occurred_at
)
select
  i.lead_id,
  'identity.added',
  'lead_phone_identity',
  i.id,
  'identity.added:' || i.id::text,
  i.created_at
from public.lead_phone_identities i
on conflict (event_key) where event_key is not null do nothing;

insert into public.lead_events (
  lead_id, event_type, entity_type, entity_id, event_key, occurred_at
)
select
  c.lead_id,
  'conversation.started',
  'conversation',
  c.id,
  'conversation.started:' || c.id::text,
  c.created_at
from public.chat_conversations c
on conflict (event_key) where event_key is not null do nothing;

insert into public.lead_events (
  lead_id, event_type, entity_type, entity_id, event_key, occurred_at
)
select d.lead_id, 'deal.created', 'deal', d.id, 'deal.created:' || d.id::text, d.created_at
from public.deals d
on conflict (event_key) where event_key is not null do nothing;

-- Limpar uma conversa altera conteúdo e registra o tombstone na mesma
-- transação. Se qualquer etapa falhar, nada é parcialmente apagado.
create or replace function public.clear_chat_conversation(
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.chat_conversations%rowtype;
  v_cleared integer := 0;
begin
  perform 1
  from public.chat_conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception 'conversation_not_found'
      using errcode = 'P0002';
  end if;

  update public.chat_messages
  set is_deleted = true,
      content = null,
      media_url = null
  where conversation_id = p_conversation_id
    and is_deleted = false;
  get diagnostics v_cleared = row_count;

  update public.chat_conversations
  set last_message_at = null,
      last_message_preview = null,
      unread_count = 0,
      updated_at = now()
  where id = p_conversation_id
  returning * into v_conversation;

  insert into public.lead_events (
    lead_id, event_type, entity_type, entity_id, metadata, occurred_at
  ) values (
    v_conversation.lead_id,
    'conversation.cleared',
    'conversation',
    v_conversation.id,
    jsonb_build_object('clearedMessages', v_cleared),
    now()
  );

  return jsonb_build_object(
    'conversation', to_jsonb(v_conversation),
    'cleared', v_cleared
  );
end;
$$;

revoke execute on function public.clear_chat_conversation(uuid)
  from public, anon, authenticated;
grant execute on function public.clear_chat_conversation(uuid)
  to service_role;

notify pgrst, 'reload schema';
