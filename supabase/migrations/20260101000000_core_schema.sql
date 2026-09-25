-- Core schema — reconstruído a partir de src/lib/supabase/types.ts (fonte de verdade
-- do app) para dar paridade ao Supabase local. As tabelas de chat ficam na migration
-- 20260622_chat_module.sql. Usa "if not exists" para ser seguro de reaplicar.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),
  name              text,
  phone             text,
  normalized_phone  text not null,
  instagram_user    text,
  email             text,
  -- Origem / triagem
  source            text,
  agencia_nome      text,
  modelo_nome       text,
  -- Funil (status é livre; referencia board_columns.key)
  status            text not null default 'novo',
  -- Qualificação
  tipo_ensaio       text,
  interesse         text,
  valor_estimado    numeric(12,2),
  is_recorrente     boolean default false,
  historico_compras text,
  imported          boolean default false,
  -- IA / notas
  memoria_contexto  text,
  notes             text,
  -- Timestamps de etapa
  last_message_at   timestamptz,
  qualificado_at    timestamptz,
  agendado_at       timestamptz,
  compareceu_at     timestamptz,
  cliente_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint leads_normalized_phone_key unique (normalized_phone)
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx     on public.leads (status);
create index if not exists leads_source_idx     on public.leads (source);

-- ---------------------------------------------------------------------------
-- tags  +  lead_tags (N:N)
-- ---------------------------------------------------------------------------
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default 'slate',
  created_at timestamptz not null default now()
);

create table if not exists public.lead_tags (
  lead_id    uuid not null,
  tag_id     uuid not null,
  created_at timestamptz not null default now(),
  constraint lead_tags_pkey primary key (lead_id, tag_id),
  constraint lead_tags_lead_id_fkey foreign key (lead_id) references public.leads (id) on delete cascade,
  constraint lead_tags_tag_id_fkey  foreign key (tag_id)  references public.tags  (id) on delete cascade
);

create index if not exists lead_tags_tag_id_idx on public.lead_tags (tag_id);

-- ---------------------------------------------------------------------------
-- board_columns (etapas do funil / kanban)
-- ---------------------------------------------------------------------------
create table if not exists public.board_columns (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  label      text not null,
  color      text not null default 'slate',
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  constraint board_columns_key_key unique (key)
);

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid,
  scheduled_at     timestamptz not null,
  duration_min     integer,
  tipo_ensaio      text,
  status           text not null default 'agendado',
  google_event_id  text,
  reminder_d3_sent boolean not null default false,
  reminder_d0_sent boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint appointments_lead_id_fkey foreign key (lead_id) references public.leads (id) on delete set null,
  constraint appointments_status_check check (status in ('agendado','confirmado','compareceu','faltou','cancelado'))
);

create index if not exists appointments_lead_id_idx      on public.appointments (lead_id);
create index if not exists appointments_scheduled_at_idx on public.appointments (scheduled_at desc);
create index if not exists appointments_status_idx       on public.appointments (status);

-- ---------------------------------------------------------------------------
-- followups
-- ---------------------------------------------------------------------------
create table if not exists public.followups (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid,
  scheduled_for timestamptz not null,
  status        text not null default 'pendente',
  message       text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  constraint followups_lead_id_fkey foreign key (lead_id) references public.leads (id) on delete cascade,
  constraint followups_status_check check (status in ('pendente','enviado','cancelado'))
);

create index if not exists followups_lead_id_idx       on public.followups (lead_id);
create index if not exists followups_scheduled_for_idx on public.followups (scheduled_for);

-- ---------------------------------------------------------------------------
-- contracts
-- ---------------------------------------------------------------------------
create table if not exists public.contracts (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid,
  package_name  text,
  total_amount  numeric(12,2) not null,
  signal_amount numeric(12,2) not null default 0,
  discount      numeric(12,2) not null default 0,
  status        text not null default 'aberto',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint contracts_lead_id_fkey foreign key (lead_id) references public.leads (id) on delete set null,
  constraint contracts_status_check check (status in ('aberto','quitado','cancelado'))
);

create index if not exists contracts_lead_id_idx on public.contracts (lead_id);
create index if not exists contracts_status_idx  on public.contracts (status);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid,
  contract_id  uuid,
  amount       numeric(12,2) not null,
  method       text,
  installments integer not null default 1,
  is_signal    boolean not null default false,
  status       text not null default 'pendente',
  due_at       timestamptz,
  paid_at      timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  constraint payments_lead_id_fkey     foreign key (lead_id)     references public.leads     (id) on delete set null,
  constraint payments_contract_id_fkey foreign key (contract_id) references public.contracts (id) on delete set null,
  constraint payments_status_check check (status in ('pago','pendente','estornado')),
  constraint payments_method_check check (method is null or method in ('pix','credito','debito','dinheiro','link','parcelado'))
);

create index if not exists payments_lead_id_idx     on public.payments (lead_id);
create index if not exists payments_contract_id_idx on public.payments (contract_id);
create index if not exists payments_status_idx      on public.payments (status);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,
  kind        text not null default 'variavel',
  description text,
  amount      numeric(12,2) not null,
  status      text not null default 'pendente',
  due_at      timestamptz,
  paid_at     timestamptz,
  recurring   boolean not null default false,
  vendor      text,
  notes       text,
  created_at  timestamptz not null default now(),
  constraint expenses_kind_check   check (kind in ('fixa','variavel')),
  constraint expenses_status_check check (status in ('pago','pendente'))
);

create index if not exists expenses_category_idx on public.expenses (category);
create index if not exists expenses_status_idx   on public.expenses (status);
create index if not exists expenses_due_at_idx   on public.expenses (due_at);

-- ---------------------------------------------------------------------------
-- feedback_requests
-- ---------------------------------------------------------------------------
create table if not exists public.feedback_requests (
  id          uuid primary key default gen_random_uuid(),
  image_url   text,
  caption     text,
  author_name text,
  status      text not null default 'pending',
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_requests_status_idx     on public.feedback_requests (status);
create index if not exists feedback_requests_created_at_idx on public.feedback_requests (created_at desc);

-- ---------------------------------------------------------------------------
-- integration_logs
-- ---------------------------------------------------------------------------
create table if not exists public.integration_logs (
  id         uuid primary key default gen_random_uuid(),
  provider   text not null,
  direction  text,
  action     text,
  status     text,
  payload    jsonb,
  error      text,
  created_at timestamptz not null default now(),
  constraint integration_logs_direction_check check (direction is null or direction in ('inbound','outbound')),
  constraint integration_logs_status_check    check (status is null or status in ('ok','error'))
);

create index if not exists integration_logs_created_at_idx on public.integration_logs (created_at desc);
create index if not exists integration_logs_provider_idx   on public.integration_logs (provider);
