-- ============================================================================
--   20261008160000_agenda_followups.sql  —  Fase 7: Agenda + Follow-ups
--
--   Recupera os módulos da clínica (tag legado-clinica), REINTERPRETADOS para o
--   suporte técnico. O que muda em relação ao legado:
--     - `appointments`: era preso a `lead_id` + `tipo_ensaio` (ensaio de foto) +
--       Google Calendar + lembretes. Agora: `kind` (visita técnica, treinamento,
--       implantação, acesso remoto), vínculo opcional a TICKET e a EMPRESA
--       (customer), e um técnico responsável (app_user). Sem Google, sem lembrete.
--     - `followups`: era `lead_id` + `scheduled_for` + mensagem automática. Agora
--       é um RETORNO LIGADO A TICKET: `ticket_id` + `due_at` + `kind`, uma tarefa
--       que um humano conclui (não um disparo automático).
--     - `agenda_blocks`: bloqueios de disponibilidade, agora por técnico (ou
--       globais).
--
--   NÃO porta a config da clínica (`appointment_types`, `clinic_units`,
--   `agenda_hours`): o tipo do compromisso é um enum fixo (cor por tipo na UI),
--   não uma tabela configurável.
--
--   Escrita só pelo servidor (service_role, pelas rotas sob sessão); molde a
--   (grant direto, sem RPC), como `external_contracts`. RLS ligada e NENHUMA
--   policy: anon/authenticated não alcançam. Termina com assert_security_baseline().
-- ============================================================================

do $$
begin
  if to_regclass('public.customers') is null
     or to_regclass('public.tickets') is null
     or to_regclass('public.contacts') is null
     or to_regclass('public.app_users') is null
     or to_regprocedure('public.assert_security_baseline()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'AGENDA_FOLLOWUPS: aplique as migrations de fundação/cadastros/tickets antes';
  end if;
end
$$;

-- ============================================================================
-- 1. appointments — compromissos de agenda
-- ============================================================================

create table if not exists public.appointments (
  id                 uuid primary key default gen_random_uuid(),
  -- O tipo é um enum fixo (cor por tipo na UI), não uma tabela configurável.
  kind               text not null,
  title              text,
  -- Vínculos, todos opcionais e com ON DELETE SET NULL: apagar o ticket, a
  -- empresa ou o técnico NÃO apaga o registro de agenda (histórico preservado).
  ticket_id          uuid,
  customer_id        uuid,
  contact_id         uuid,
  assignee_id        uuid,
  scheduled_at       timestamptz not null,
  duration_min       integer,
  location           text,
  status             text not null default 'agendado',
  notes              text,
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint appointments_ticket_id_fkey
    foreign key (ticket_id) references public.tickets (id) on delete set null,
  constraint appointments_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete set null,
  constraint appointments_contact_id_fkey
    foreign key (contact_id) references public.contacts (id) on delete set null,
  constraint appointments_assignee_id_fkey
    foreign key (assignee_id) references public.app_users (id) on delete set null,
  constraint appointments_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint appointments_kind_check
    check (kind in ('visita_tecnica', 'treinamento', 'implantacao', 'acesso_remoto')),
  constraint appointments_status_check
    check (status in ('agendado', 'confirmado', 'realizado', 'cancelado')),
  constraint appointments_title_check
    check (title is null or char_length(title) <= 200),
  constraint appointments_duration_check
    check (duration_min is null or (duration_min > 0 and duration_min <= 1440)),
  constraint appointments_location_check
    check (location is null or char_length(location) <= 300)
);

comment on table public.appointments is
  'Compromissos de agenda do suporte (Fase 7): visita técnica, treinamento, implantação, acesso remoto. Vínculo opcional a ticket e empresa, com um técnico responsável. Escrita só pelo servidor (service_role).';

create index if not exists appointments_scheduled_at_idx on public.appointments (scheduled_at);
create index if not exists appointments_status_idx       on public.appointments (status);
create index if not exists appointments_customer_id_idx  on public.appointments (customer_id);
create index if not exists appointments_ticket_id_idx    on public.appointments (ticket_id);
create index if not exists appointments_assignee_id_idx  on public.appointments (assignee_id);

-- ============================================================================
-- 2. followups — retornos ligados a ticket
-- ============================================================================

create table if not exists public.followups (
  id                 uuid primary key default gen_random_uuid(),
  -- O follow-up SEMPRE pertence a um ticket (a reinterpretação da Fase 7); se o
  -- ticket some, o retorno some junto.
  ticket_id          uuid not null,
  due_at             timestamptz not null,
  kind               text not null default 'retorno',
  status             text not null default 'pendente',
  notes              text,
  done_at            timestamptz,
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint followups_ticket_id_fkey
    foreign key (ticket_id) references public.tickets (id) on delete cascade,
  constraint followups_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint followups_kind_check
    check (kind in ('retorno', 'verificacao', 'cobranca')),
  constraint followups_status_check
    check (status in ('pendente', 'concluido', 'cancelado')),
  -- done_at só faz sentido quando concluído, e concluído exige done_at.
  constraint followups_done_at_consistent
    check ((status = 'concluido') = (done_at is not null))
);

comment on table public.followups is
  'Retornos ligados a ticket (Fase 7): uma tarefa de acompanhamento (retorno/verificação/cobrança) com prazo, concluída por um humano. Escrita só pelo servidor (service_role).';

create index if not exists followups_ticket_id_idx on public.followups (ticket_id);
-- A fila de pendentes por vencer / vencidos: filtra por status e ordena por prazo.
create index if not exists followups_pending_due_idx
  on public.followups (due_at)
  where status = 'pendente';

-- ============================================================================
-- 3. agenda_blocks — bloqueios de disponibilidade
-- ============================================================================

create table if not exists public.agenda_blocks (
  id                 uuid primary key default gen_random_uuid(),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  all_day            boolean not null default false,
  reason             text,
  -- Bloqueio de um técnico específico, ou NULL = bloqueio global (feriado etc.).
  assignee_id        uuid,
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint agenda_blocks_assignee_id_fkey
    foreign key (assignee_id) references public.app_users (id) on delete set null,
  constraint agenda_blocks_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint agenda_blocks_range_valid check (ends_at > starts_at),
  constraint agenda_blocks_reason_check
    check (reason is null or char_length(reason) <= 300)
);

comment on table public.agenda_blocks is
  'Bloqueios de disponibilidade da agenda (Fase 7): por técnico (assignee_id) ou globais (assignee_id null). Escrita só pelo servidor (service_role).';

create index if not exists agenda_blocks_range_idx     on public.agenda_blocks (starts_at, ends_at);
create index if not exists agenda_blocks_assignee_idx  on public.agenda_blocks (assignee_id);

-- ============================================================================
-- 4. RLS e privilégios (RLS ligada, NENHUMA policy; só service_role escreve)
-- ============================================================================

alter table public.appointments  enable row level security;
alter table public.followups      enable row level security;
alter table public.agenda_blocks  enable row level security;

revoke all on table public.appointments  from public, anon, authenticated, service_role;
revoke all on table public.followups      from public, anon, authenticated, service_role;
revoke all on table public.agenda_blocks  from public, anon, authenticated, service_role;

-- CRUD simples pelo servidor (as rotas sob sessão autorizam; o banco não).
-- Sem TRUNCATE/TRIGGER/REFERENCES (baseline §11).
grant select, insert, update, delete on table public.appointments  to service_role;
grant select, insert, update, delete on table public.followups      to service_role;
grant select, insert, update, delete on table public.agenda_blocks  to service_role;

-- ============================================================================
-- 5. Triggers de updated_at
-- ============================================================================

drop trigger if exists trg_appointments_set_updated_at on public.appointments;
create trigger trg_appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_followups_set_updated_at on public.followups;
create trigger trg_followups_set_updated_at
  before update on public.followups
  for each row execute function public.set_updated_at();

drop trigger if exists trg_agenda_blocks_set_updated_at on public.agenda_blocks;
create trigger trg_agenda_blocks_set_updated_at
  before update on public.agenda_blocks
  for each row execute function public.set_updated_at();

-- O PostgREST guarda o schema em cache; sem o reload ele segue com o mapa antigo.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
