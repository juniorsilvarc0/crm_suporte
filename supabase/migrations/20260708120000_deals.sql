-- ============================================================================
-- deals — cards de agendamento do funil (N por lead)
-- ----------------------------------------------------------------------------
-- Antes: o board renderizava leads agrupados por leads.status; como leads tem
-- índice único em normalized_phone (upsert por telefone), um cliente recorrente
-- colapsava em 1 card. Agora cada agendamento é um `deal` = 1 card movível no
-- funil. O lead continua único (dono do contato/chat); cada deal tem sua etapa
-- (deals.stage, livre, referencia board_columns.key, igual leads.status).
-- ============================================================================

create table if not exists public.deals (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null,
  appointment_id  uuid,                            -- preenchido quando o deal veio de um agendamento
  title           text,
  tipo_ensaio     text,
  valor           numeric(12,2),
  stage           text not null default 'novo',    -- referencia board_columns.key (livre)
  scheduled_at    timestamptz,
  notes           text,
  source          text not null default 'lead',    -- 'lead' | 'appointment' | 'manual' | 'agent'
  idempotency_key text,
  won_at          timestamptz,
  lost_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint deals_lead_id_fkey
    foreign key (lead_id) references public.leads (id) on delete cascade,
  constraint deals_appointment_id_fkey
    foreign key (appointment_id) references public.appointments (id) on delete set null
);

create index if not exists deals_lead_id_idx     on public.deals (lead_id);
create index if not exists deals_stage_idx        on public.deals (stage);
create index if not exists deals_created_at_idx   on public.deals (created_at desc);
-- Índices únicos NÃO-parciais (nulls distintos) para o onConflict do supabase-js
-- inferir a constraint, sem colidir quando a chave é nula.
create unique index if not exists deals_idempotency_key_uidx on public.deals (idempotency_key);
create unique index if not exists deals_appointment_id_uidx  on public.deals (appointment_id);

-- RLS: só service_role (espelha 20260706120000_rls_tabelas_core.sql — sem policies).
alter table public.deals enable row level security;
revoke all on public.deals from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Trigger: todo lead novo (não importado) ganha 1 deal na sua etapa atual.
-- Cobre TODOS os caminhos de criação (integração, n8n, manual, chat inbound).
-- Nota: INSERT ... ON CONFLICT DO UPDATE só dispara AFTER INSERT na linha
-- realmente inserida, então o upsert-por-telefone do chat NÃO gera deal a cada
-- mensagem — só no primeiro contato (insert real).
-- ----------------------------------------------------------------------------
create or replace function public.create_initial_deal()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if coalesce(new.imported, false) = false then
    insert into public.deals (lead_id, stage, tipo_ensaio, valor, source)
    values (new.id, new.status, new.tipo_ensaio, new.valor_estimado, 'lead');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_create_initial_deal on public.leads;
create trigger trg_leads_create_initial_deal
  after insert on public.leads
  for each row
  execute function public.create_initial_deal();

-- ----------------------------------------------------------------------------
-- Backfill: 1 deal por lead existente não-importado que ainda não tem deal.
-- Idempotente (o not exists evita duplicar em reexecução).
-- ----------------------------------------------------------------------------
insert into public.deals (lead_id, stage, tipo_ensaio, valor, source)
select l.id, l.status, l.tipo_ensaio, l.valor_estimado, 'lead'
from public.leads l
where coalesce(l.imported, false) = false
  and not exists (select 1 from public.deals d where d.lead_id = l.id);
