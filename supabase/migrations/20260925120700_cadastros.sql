-- ============================================================================
-- Fase 3 · Cadastros — empresa, fila (produto), plano e contrato de suporte,
-- e o vínculo contato → empresa.
--
--   products                   a FILA: cada software da casa (tickets.product_id
--                              na Fase 4). Nome único entre ativos.
--   support_plans              plano de suporte (rótulo do contrato). SEM preço.
--   customers                  a EMPRESA: razão social, fantasia, CNPJ e o selo.
--   contacts.customer_id       ganha a FK (a coluna nasceu em _contatos).
--   support_contracts          contrato de suporte da empresa.
--   support_contract_products  produtos (filas) cobertos pelo contrato.
--
-- Invariantes que moram AQUI (a API v1 da Fase 5 escreve nas mesmas tabelas):
--   1. CNPJ sem máscara, [0-9A-Z]{12}[0-9]{2} (alfanumérico, IN RFB 2.229/2024,
--      emitido desde jul/2026). O DV é conferido no zod compartilhado
--      (src/lib/formatters/cnpj.ts), como o CPF no legado. Único entre ATIVAS.
--   2. No máximo UM contrato VIGENTE (ativo OU suspenso) por empresa: o selo
--      nunca tem dois candidatos. Mais estrito que o "1 ativo" do plano.
--   3. O VALOR (monthly_amount) não é legível pelo service_role. Sai só por
--      get_support_contract_amounts, que confere admin ATIVO no banco. Um
--      select('*'), um embed support_contracts(*) ou um serializer da API v1
--      falham com 42501 em vez de vazar.
--   4. Contrato só é escrito pelas RPCs (admin ativo conferido no banco;
--      contrato + produtos numa transação). O service_role não tem
--      INSERT/UPDATE/DELETE em support_contracts/support_contract_products.
--   5. customers.contract_status é o SELO, derivado por trigger; o app não
--      escreve nele. Chat e listas leem só customers.
--   6. Empresa arquivada não recebe contrato nem vínculo novo e não arquiva com
--      contrato vigente. Os contatos já ligados continuam (histórico).
--   7. Ligar/trocar/desligar empresa vira evento em contact_events.
--
-- Segurança (AGENTS §3.1): RLS ligada e SEM policy; nada para PUBLIC/anon/
-- authenticated; nada entra no Realtime. Toda função com search_path = ''.
--
-- Depende de 20260925120000..20260925120600.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Pré-requisitos
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.assert_security_baseline()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'CADASTROS: aplique 20260925120000_fundacao antes';
  end if;
  if to_regclass('public.app_users') is null then
    raise exception 'CADASTROS: aplique 20260925120100_usuarios antes';
  end if;
  if to_regclass('public.contacts') is null
     or to_regclass('public.contact_events') is null
     or to_regprocedure('public.normalize_search_text(text)') is null
     or to_regprocedure('public.record_contact_row_event()') is null then
    raise exception 'CADASTROS: aplique 20260925120300_contatos antes';
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_attribute a
     where a.attrelid = to_regclass('public.contacts')
       and a.attname = 'customer_id'
       and not a.attisdropped
  ) then
    raise exception 'CADASTROS: contacts.customer_id ausente (vem de _contatos)';
  end if;
end
$$;

-- ============================================================================
-- 1. Tabelas
-- ============================================================================

-- Fase 3 só CRIA produto (no formulário de contrato, admin). Renomear, cor,
-- nicho e arquivar chegam com a tela de filas (Fase 4f).
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  niche       text,
  color       text not null default 'slate',
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint products_name_check
    check (btrim(name) <> '' and char_length(name) <= 80),
  constraint products_niche_check
    check (niche is null or (btrim(niche) <> '' and char_length(niche) <= 80)),
  -- Nome da paleta (features/tags/schemas/colors.ts), como tags.color.
  constraint products_color_format_check
    check (color ~ '^[a-z]{3,20}$')
);

create table if not exists public.support_plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint support_plans_name_check
    check (btrim(name) <> '' and char_length(name) <= 80),
  constraint support_plans_description_check
    check (description is null or (btrim(description) <> '' and char_length(description) <= 500))
);

-- `||` + coalesce, não concat_ws: concat_ws é STABLE e coluna gerada exige
-- IMMUTABLE. O CNPJ cru entra no search_name: a busca por tokens acha
-- "12.ABC.345/01DE-35" e "12abc345" sem .or().
create table if not exists public.customers (
  id                 uuid primary key default gen_random_uuid(),
  legal_name         text not null,
  trade_name         text,
  cnpj               text,
  notes              text,
  contract_status    text,
  created_by_user_id uuid,
  archived_at        timestamptz,
  search_name        text generated always as (
    public.normalize_search_text(
      coalesce(trade_name, '') || ' ' || legal_name || ' ' || coalesce(cnpj, '')
    )
  ) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint customers_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint customers_legal_name_check
    check (btrim(legal_name) <> '' and char_length(legal_name) <= 160),
  constraint customers_trade_name_check
    check (trade_name is null or (btrim(trade_name) <> '' and char_length(trade_name) <= 160)),
  constraint customers_cnpj_format_check
    check (cnpj is null or cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  constraint customers_notes_check
    check (notes is null or (btrim(notes) <> '' and char_length(notes) <= 2000)),
  constraint customers_contract_status_check
    check (contract_status is null or contract_status in ('ativo', 'suspenso', 'encerrado'))
);

create table if not exists public.support_contracts (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null,
  plan_id            uuid,
  status             text not null default 'ativo',
  starts_on          date not null,
  ends_on            date,
  monthly_amount     numeric(12, 2) not null,
  billing_day        smallint not null,
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint support_contracts_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete restrict,
  constraint support_contracts_plan_id_fkey
    foreign key (plan_id) references public.support_plans (id) on delete restrict,
  constraint support_contracts_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint support_contracts_status_check
    check (status in ('ativo', 'suspenso', 'encerrado')),
  constraint support_contracts_term_check
    check (ends_on is null or ends_on >= starts_on),
  constraint support_contracts_closed_has_end_check
    check (status <> 'encerrado' or ends_on is not null),
  constraint support_contracts_amount_check
    check (monthly_amount >= 0),
  -- 1..28 existe em todo mês: a Fase 8 gera a competência com make_date sem
  -- regra de "último dia" duplicada entre SQL e TS.
  constraint support_contracts_billing_day_check
    check (billing_day between 1 and 28)
);

create table if not exists public.support_contract_products (
  contract_id uuid not null,
  product_id  uuid not null,
  created_at  timestamptz not null default now(),
  constraint support_contract_products_pkey primary key (contract_id, product_id),
  constraint support_contract_products_contract_id_fkey
    foreign key (contract_id) references public.support_contracts (id) on delete cascade,
  constraint support_contract_products_product_id_fkey
    foreign key (product_id) references public.products (id) on delete restrict
);

-- contacts: SÓ a FK. Coluna, índice parcial e UPDATE(customer_id) vieram de
-- _contatos. Nada de `revoke all on public.contacts`: apagaria os grants por
-- coluna de lá.
do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.contacts'::regclass
       and conname = 'contacts_customer_id_fkey'
  ) then
    alter table public.contacts
      add constraint contacts_customer_id_fkey
      foreign key (customer_id) references public.customers (id) on delete restrict;
  end if;
end
$$;

-- ============================================================================
-- 2. Índices
-- ============================================================================

-- Mesmo critério de tags_name_lower_uidx; arquivar libera o nome.
create unique index if not exists products_name_active_uidx
  on public.products (lower(btrim(name)))
  where archived_at is null;

create unique index if not exists support_plans_name_active_uidx
  on public.support_plans (lower(btrim(name)))
  where archived_at is null;

-- Plano §B: único PARCIAL. Arquivar libera o recadastro; NULLs convivem.
create unique index if not exists customers_cnpj_active_uidx
  on public.customers (cnpj)
  where cnpj is not null and archived_at is null;

create index if not exists customers_active_search_name_trgm_idx
  on public.customers using gin (search_name extensions.gin_trgm_ops)
  where archived_at is null;

create index if not exists customers_archived_at_idx
  on public.customers (archived_at)
  where archived_at is not null;

-- Cursor (updated_at, id) e updated_since da API v1 (plano §C).
create index if not exists customers_updated_at_id_idx
  on public.customers (updated_at, id);

-- Invariante 2.
create unique index if not exists support_contracts_one_current_per_customer_uidx
  on public.support_contracts (customer_id)
  where status in ('ativo', 'suspenso');

create index if not exists support_contracts_customer_id_idx
  on public.support_contracts (customer_id, starts_on desc);

create index if not exists support_contracts_plan_id_idx
  on public.support_contracts (plan_id)
  where plan_id is not null;

create index if not exists support_contract_products_product_id_idx
  on public.support_contract_products (product_id);

-- ============================================================================
-- 3. RLS e privilégios de tabela (RLS ligada, NENHUMA policy)
-- ============================================================================

alter table public.products                  enable row level security;
alter table public.support_plans             enable row level security;
alter table public.customers                 enable row level security;
alter table public.support_contracts         enable row level security;
alter table public.support_contract_products enable row level security;

revoke all on table
  public.products,
  public.support_plans,
  public.customers,
  public.support_contracts,
  public.support_contract_products
from public, anon, authenticated, service_role;

grant select on table public.products to service_role;
grant insert (name, niche, color) on table public.products to service_role;

grant select on table public.support_plans to service_role;
grant insert (name, description) on table public.support_plans to service_role;

-- Sem DELETE (arquiva). contract_status fica FORA: só o trigger escreve o selo.
grant select on table public.customers to service_role;
grant insert (legal_name, trade_name, cnpj, notes, created_by_user_id)
  on table public.customers to service_role;
grant update (legal_name, trade_name, cnpj, notes, archived_at, updated_at)
  on table public.customers to service_role;

-- Contrato: SELECT por coluna SEM monthly_amount; nenhuma escrita direta.
-- ⚠️ select('*'), .select() sem argumento e embed support_contracts(*) = 42501.
grant select (
  id, customer_id, plan_id, status, starts_on, ends_on,
  billing_day, created_by_user_id, created_at, updated_at
) on table public.support_contracts to service_role;

grant select on table public.support_contract_products to service_role;

-- ============================================================================
-- 4. Triggers
-- ============================================================================

drop trigger if exists trg_products_set_updated_at on public.products;
create trigger trg_products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_support_plans_set_updated_at on public.support_plans;
create trigger trg_support_plans_set_updated_at
  before update on public.support_plans
  for each row execute function public.set_updated_at();

drop trigger if exists trg_customers_set_updated_at on public.customers;
create trigger trg_customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_support_contracts_set_updated_at on public.support_contracts;
create trigger trg_support_contracts_set_updated_at
  before update on public.support_contracts
  for each row execute function public.set_updated_at();

-- Invariante 6a. Invoker: o service_role lê support_contracts(customer_id,
-- status). A corrida com create_support_contract fecha porque a RPC trava a
-- MESMA linha de customers (FOR UPDATE) e esta consulta, numa função volátil,
-- tira snapshot novo depois da espera.
create or replace function public.guard_customer_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.archived_at is null
     and new.archived_at is not null
     and exists (
       select 1
         from public.support_contracts c
        where c.customer_id = new.id
          and c.status in ('ativo', 'suspenso')
     ) then
    raise exception 'CUSTOMER_HAS_CURRENT_CONTRACT'
      using detail = 'Encerre o contrato vigente antes de arquivar a empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customers_guard_archive on public.customers;
create trigger trg_customers_guard_archive
  before update of archived_at on public.customers
  for each row execute function public.guard_customer_archive();

-- Invariante 6b. Invoker e sem trava: se arquivar e ligar correrem juntos, o
-- resultado (contato ligado a empresa arquivada) é um estado já permitido.
-- Empresa inexistente: a FK responde 23503 logo depois.
create or replace function public.guard_contact_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is not null
     and new.customer_id is distinct from old.customer_id
     and exists (
       select 1
         from public.customers cu
        where cu.id = new.customer_id
          and cu.archived_at is not null
     ) then
    raise exception 'CUSTOMER_ARCHIVED'
      using detail = 'Empresa arquivada não recebe contato. Reative-a antes.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contacts_guard_customer on public.contacts;
create trigger trg_contacts_guard_customer
  before update of customer_id on public.contacts
  for each row execute function public.guard_contact_customer();

-- Invariante 5. Selo = status do vigente; senão do último encerrado; senão
-- nulo. Invoker: só o dono escreve contrato (pelas RPCs). Se um dia o
-- service_role ganhar escrita em status, este UPDATE falha com 42501 —
-- fechado, não aberto.
create or replace function public.sync_customer_contract_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select c.status
    into v_status
    from public.support_contracts c
   where c.customer_id = new.customer_id
   order by (c.status <> 'encerrado') desc, c.ends_on desc nulls first, c.created_at desc
   limit 1;

  update public.customers cu
     set contract_status = v_status
   where cu.id = new.customer_id
     and cu.contract_status is distinct from v_status;

  return null;
end;
$$;

drop trigger if exists trg_support_contracts_sync_customer_status on public.support_contracts;
create trigger trg_support_contracts_sync_customer_status
  after insert or update of status on public.support_contracts
  for each row execute function public.sync_customer_contract_status();

-- Invariante 7. Corpo IDÊNTICO ao de 20260925120300_contatos + o ramo de
-- customer_id. Sem isto, "desde quando este contato é da empresa X" se perde.
create or replace function public.record_contact_row_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.contact_events (
      contact_id, event_type, entity_type, entity_id, event_key, occurred_at
    ) values (
      new.id, 'contact.created', 'contact', new.id,
      'contact.created:' || new.id::text, new.created_at
    )
    on conflict (event_key) where event_key is not null do nothing;
    return new;
  end if;

  if old.archived_at is distinct from new.archived_at then
    insert into public.contact_events (
      contact_id, event_type, entity_type, entity_id, occurred_at
    ) values (
      new.id,
      case when new.archived_at is null then 'contact.reactivated' else 'contact.archived' end,
      'contact',
      new.id,
      now()
    );
  end if;

  if old.anonymized_at is null and new.anonymized_at is not null then
    insert into public.contact_events (
      contact_id, event_type, entity_type, entity_id, event_key, occurred_at
    ) values (
      new.id, 'contact.anonymized', 'contact', new.id,
      'contact.anonymized:' || new.id::text, new.anonymized_at
    )
    on conflict (event_key) where event_key is not null do nothing;
  end if;

  if old.customer_id is distinct from new.customer_id then
    insert into public.contact_events (
      contact_id, event_type, entity_type, entity_id, metadata, occurred_at
    ) values (
      new.id,
      case
        when new.customer_id is null then 'contact.customer_unlinked'
        when old.customer_id is null then 'contact.customer_linked'
        else 'contact.customer_changed'
      end,
      'customer',
      coalesce(new.customer_id, old.customer_id),
      pg_catalog.jsonb_build_object('from', old.customer_id, 'to', new.customer_id),
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contacts_record_event on public.contacts;
create trigger trg_contacts_record_event
  after insert or update of archived_at, anonymized_at, customer_id on public.contacts
  for each row execute function public.record_contact_row_event();

-- ============================================================================
-- 5. RPCs de contrato — única porta de escrita e de leitura do valor.
-- Molde de update_app_user: o ator vem da sessão (auth.viewer.id, confirmado
-- no banco pelo guard da rota) e o banco confere de novo: admin ATIVO.
-- ============================================================================

-- Helpers internos: sem EXECUTE para ninguém; só as RPCs (como dono) chamam.
create or replace function public.require_active_admin(p_actor_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1
      from public.app_users u
     where u.id = p_actor_id
       and u.is_active
       and u.role = 'admin'
  ) then
    raise exception 'FORBIDDEN'
      using detail = 'Apenas administradores ativos gerenciam contratos.';
  end if;
end;
$$;

-- Plano e produtos existem; arquivado só permanece em quem já o tinha.
create or replace function public.assert_contract_refs(
  p_plan_id     uuid,
  p_product_ids uuid[],
  p_contract_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_plan_id is not null then
    if not exists (select 1 from public.support_plans p where p.id = p_plan_id) then
      raise exception 'PLAN_NOT_FOUND';
    end if;
    if exists (
         select 1 from public.support_plans p
          where p.id = p_plan_id and p.archived_at is not null
       )
       and not exists (
         select 1 from public.support_contracts c
          where c.id = p_contract_id and c.plan_id = p_plan_id
       ) then
      raise exception 'PLAN_ARCHIVED';
    end if;
  end if;

  if coalesce(pg_catalog.cardinality(p_product_ids), 0) = 0 then
    raise exception 'PRODUCTS_REQUIRED';
  end if;
  if pg_catalog.cardinality(p_product_ids) > 50 then
    raise exception 'TOO_MANY_PRODUCTS';
  end if;
  if pg_catalog.array_position(p_product_ids, null) is not null
     or exists (
       select 1
         from pg_catalog.unnest(p_product_ids) as x(id)
        where not exists (select 1 from public.products p where p.id = x.id)
     ) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if exists (
    select 1
      from pg_catalog.unnest(p_product_ids) as x(id)
      join public.products p on p.id = x.id
     where p.archived_at is not null
       and not exists (
         select 1 from public.support_contract_products l
          where l.contract_id = p_contract_id and l.product_id = x.id
       )
  ) then
    raise exception 'PRODUCT_ARCHIVED';
  end if;
end;
$$;

-- Opcionais com default NO FIM: o db:types os gera opcionais e a rota os omite.
create or replace function public.create_support_contract(
  p_actor_id       uuid,
  p_customer_id    uuid,
  p_status         text,
  p_starts_on      date,
  p_monthly_amount numeric,
  p_billing_day    integer,
  p_product_ids    uuid[],
  p_plan_id        uuid default null,
  p_ends_on        date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived_at timestamptz;
  v_id          uuid;
begin
  perform public.require_active_admin(p_actor_id);

  if p_status is null or p_status not in ('ativo', 'suspenso') then
    raise exception 'INVALID_STATUS'
      using detail = 'Contrato novo nasce ativo ou suspenso.';
  end if;

  -- Trava a empresa: dois contratos simultâneos, ou contrato durante o
  -- arquivamento, esperam um pelo outro.
  select cu.archived_at
    into v_archived_at
    from public.customers cu
   where cu.id = p_customer_id
     for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;
  if v_archived_at is not null then
    raise exception 'CUSTOMER_ARCHIVED';
  end if;
  if exists (
    select 1
      from public.support_contracts c
     where c.customer_id = p_customer_id
       and c.status in ('ativo', 'suspenso')
  ) then
    raise exception 'CURRENT_CONTRACT_EXISTS';
  end if;

  perform public.assert_contract_refs(p_plan_id, p_product_ids, null);

  insert into public.support_contracts (
    customer_id, plan_id, status, starts_on, ends_on,
    monthly_amount, billing_day, created_by_user_id
  ) values (
    p_customer_id, p_plan_id, p_status, p_starts_on, p_ends_on,
    p_monthly_amount, p_billing_day, p_actor_id
  )
  returning id into v_id;

  insert into public.support_contract_products (contract_id, product_id)
  select v_id, x.id
    from (select distinct u.id from pg_catalog.unnest(p_product_ids) as u(id)) as x;

  return v_id;
end;
$$;

-- Edição completa (o formulário manda tudo). Status e empresa NÃO mudam aqui.
create or replace function public.update_support_contract(
  p_actor_id       uuid,
  p_contract_id    uuid,
  p_starts_on      date,
  p_monthly_amount numeric,
  p_billing_day    integer,
  p_product_ids    uuid[],
  p_plan_id        uuid default null,
  p_ends_on        date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform public.require_active_admin(p_actor_id);

  select c.status
    into v_status
    from public.support_contracts c
   where c.id = p_contract_id
     for update;
  if not found then
    raise exception 'CONTRACT_NOT_FOUND';
  end if;
  if v_status = 'encerrado' then
    raise exception 'CONTRACT_CLOSED';
  end if;

  perform public.assert_contract_refs(p_plan_id, p_product_ids, p_contract_id);

  update public.support_contracts c
     set plan_id        = p_plan_id,
         starts_on      = p_starts_on,
         ends_on        = p_ends_on,
         monthly_amount = p_monthly_amount,
         billing_day    = p_billing_day
   where c.id = p_contract_id;

  delete from public.support_contract_products l
   where l.contract_id = p_contract_id
     and l.product_id <> all (p_product_ids);

  insert into public.support_contract_products (contract_id, product_id)
  select p_contract_id, x.id
    from (select distinct u.id from pg_catalog.unnest(p_product_ids) as u(id)) as x
  on conflict (contract_id, product_id) do nothing;
end;
$$;

-- ativo ↔ suspenso; ativo|suspenso → encerrado (data padrão: hoje em SP);
-- encerrado é terminal. Mesmo status = no-op idempotente. Porta única do
-- futuro evento customer.contract_status_changed (Fase 6).
create or replace function public.set_support_contract_status(
  p_actor_id    uuid,
  p_contract_id uuid,
  p_status      text,
  p_ends_on     date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_ends_on date;
begin
  perform public.require_active_admin(p_actor_id);

  if p_status is null or p_status not in ('ativo', 'suspenso', 'encerrado') then
    raise exception 'INVALID_STATUS';
  end if;

  select c.status, c.ends_on
    into v_status, v_ends_on
    from public.support_contracts c
   where c.id = p_contract_id
     for update;
  if not found then
    raise exception 'CONTRACT_NOT_FOUND';
  end if;
  if v_status = 'encerrado' then
    raise exception 'CONTRACT_CLOSED';
  end if;
  if v_status = p_status then
    return pg_catalog.jsonb_build_object('status', v_status, 'ends_on', v_ends_on, 'changed', false);
  end if;

  update public.support_contracts c
     set status  = p_status,
         ends_on = case
                     when p_status = 'encerrado'
                       then coalesce(p_ends_on, (pg_catalog.now() at time zone 'America/Sao_Paulo')::date)
                     else c.ends_on
                   end
   where c.id = p_contract_id
  returning c.status, c.ends_on into v_status, v_ends_on;

  return pg_catalog.jsonb_build_object('status', v_status, 'ends_on', v_ends_on, 'changed', true);
end;
$$;

-- Invariante 3: a ÚNICA leitura do valor.
create or replace function public.get_support_contract_amounts(
  p_actor_id    uuid,
  p_customer_id uuid
)
returns table (contract_id uuid, monthly_amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_active_admin(p_actor_id);

  -- Colunas qualificadas: as de RETURNS TABLE viram variáveis no plpgsql.
  return query
    select c.id, c.monthly_amount
      from public.support_contracts c
     where c.customer_id = p_customer_id;
end;
$$;

-- ============================================================================
-- 6. Privilégios de função (EXECUTE nasce para PUBLIC; anon herda dali)
-- ============================================================================

revoke all on function public.guard_customer_archive() from public, anon, authenticated;
revoke all on function public.guard_contact_customer() from public, anon, authenticated;
revoke all on function public.sync_customer_contract_status() from public, anon, authenticated;
revoke all on function public.record_contact_row_event() from public, anon, authenticated;
revoke all on function public.require_active_admin(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_contract_refs(uuid, uuid[], uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_support_contract(uuid, uuid, text, date, numeric, integer, uuid[], uuid, date)
  from public, anon, authenticated;
revoke all on function public.update_support_contract(uuid, uuid, date, numeric, integer, uuid[], uuid, date)
  from public, anon, authenticated;
revoke all on function public.set_support_contract_status(uuid, uuid, text, date)
  from public, anon, authenticated;
revoke all on function public.get_support_contract_amounts(uuid, uuid)
  from public, anon, authenticated;

-- Funções de trigger: mesmo padrão de _contatos.
grant execute on function public.guard_customer_archive() to service_role;
grant execute on function public.guard_contact_customer() to service_role;
grant execute on function public.sync_customer_contract_status() to service_role;
grant execute on function public.record_contact_row_event() to service_role;
grant execute on function public.create_support_contract(uuid, uuid, text, date, numeric, integer, uuid[], uuid, date)
  to service_role;
grant execute on function public.update_support_contract(uuid, uuid, date, numeric, integer, uuid[], uuid, date)
  to service_role;
grant execute on function public.set_support_contract_status(uuid, uuid, text, date) to service_role;
grant execute on function public.get_support_contract_amounts(uuid, uuid) to service_role;

-- ============================================================================
-- 7. Asserções locais (o que o baseline geral não confere) — molde _usuarios
-- ============================================================================
do $$
begin
  if pg_catalog.has_column_privilege('service_role', 'public.support_contracts', 'monthly_amount', 'SELECT') then
    raise exception 'CADASTROS: service_role lê support_contracts.monthly_amount; o valor só sai por get_support_contract_amounts';
  end if;
  if pg_catalog.has_any_column_privilege('service_role', 'public.support_contracts', 'INSERT, UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.support_contracts', 'DELETE')
     or pg_catalog.has_any_column_privilege('service_role', 'public.support_contract_products', 'INSERT, UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.support_contract_products', 'DELETE') then
    raise exception 'CADASTROS: service_role escreve contrato direto; a escrita é só pelas RPCs';
  end if;
  if pg_catalog.has_column_privilege('service_role', 'public.customers', 'contract_status', 'INSERT, UPDATE') then
    raise exception 'CADASTROS: service_role escreve customers.contract_status; o selo é só do trigger';
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.customers', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.products', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.support_plans', 'DELETE') then
    raise exception 'CADASTROS: service_role apaga cadastro; o dia a dia arquiva';
  end if;
  if pg_catalog.has_function_privilege('service_role', 'public.require_active_admin(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.assert_contract_refs(uuid,uuid[],uuid)', 'EXECUTE') then
    raise exception 'CADASTROS: helpers internos das RPCs de contrato viraram RPC';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.set_support_contract_status(uuid,uuid,text,date)', 'EXECUTE') then
    raise exception 'CADASTROS: service_role não executa set_support_contract_status';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('create_support_contract', 'update_support_contract',
                         'set_support_contract_status', 'get_support_contract_amounts')
     group by p.proname
    having count(*) > 1
  ) then
    raise exception 'CADASTROS: há sobrecarga das RPCs de contrato; a chamada ficaria ambígua';
  end if;
end
$$;

-- ============================================================================
-- 8. Documentação no catálogo
-- ============================================================================
comment on table public.products is
  'Fila de atendimento: cada software da casa. Nome único entre ativos; arquivar libera o nome.';
comment on column public.products.color is
  'Nome da paleta de src/features/tags/schemas/colors.ts, não classe CSS.';
comment on table public.support_plans is
  'Plano de suporte (rótulo). Sem preço: valor mora só no contrato.';
comment on table public.customers is
  'Empresa cliente: N contatos (contacts.customer_id) e no máximo 1 contrato vigente. Arquiva, nunca apaga.';
comment on column public.customers.cnpj is
  'Sem máscara, [0-9A-Z]{12}[0-9]{2} (aceita o alfanumérico). DV conferido no zod. Único entre ativas.';
comment on column public.customers.contract_status is
  'Selo: status do contrato vigente, senão do último encerrado, senão nulo. Escrito só por trigger.';
comment on column public.customers.search_name is
  'normalize_search_text(fantasia razão cnpj): busca por tokens (trigram) e ordem alfabética.';
comment on column public.contacts.customer_id is
  'Empresa do contato (N:1, FK restrict). Não aponta para empresa arquivada em vínculo novo. Vínculo vira contact_events.';
comment on table public.support_contracts is
  'Contrato de suporte. Escrita só pelas RPCs (admin ativo). Um vigente (ativo|suspenso) por empresa; encerrado é terminal.';
comment on column public.support_contracts.monthly_amount is
  'Valor mensal. SEM SELECT para o service_role: leia por get_support_contract_amounts (admin ativo). Nunca na API.';
comment on column public.support_contracts.billing_day is
  'Dia de vencimento, 1..28: existe em todo mês.';
comment on function public.create_support_contract(uuid, uuid, text, date, numeric, integer, uuid[], uuid, date) is
  'Cria contrato + produtos numa transação. Admin ativo; empresa travada; um vigente por empresa.';
comment on function public.update_support_contract(uuid, uuid, date, numeric, integer, uuid[], uuid, date) is
  'Edita contrato não encerrado e substitui o conjunto de produtos. Não muda status nem empresa.';
comment on function public.set_support_contract_status(uuid, uuid, text, date) is
  'Única porta de mudança de status. encerrado é terminal (data padrão: hoje em SP).';
comment on function public.get_support_contract_amounts(uuid, uuid) is
  'Única leitura de monthly_amount: contratos de uma empresa, só para admin ativo.';

notify pgrst, 'reload schema';

select public.assert_security_baseline();
