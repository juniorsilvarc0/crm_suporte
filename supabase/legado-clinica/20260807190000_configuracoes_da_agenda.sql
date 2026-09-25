-- ---------------------------------------------------------------------------
-- Configurações da Agenda: tipos de atendimento, unidades e grade de horários.
--
-- Contexto: três coisas estavam presas no código e não deveriam estar.
--
--   1. Os tipos de agendamento eram uma constante de UI (`tipoServicoOptions`)
--      com "Reunião / Demonstração / Proposta / Onboarding" — vocabulário de
--      software B2B numa agenda de clínica. Vira catálogo mantido pelo usuário,
--      no mesmo formato de `procedures`, `tags` e `board_columns`.
--
--   2. A grade de horários (`QUICK_TIMES_BY_WEEKDAY`) era um objeto literal em
--      `agenda-utils.ts`. Mudar o expediente exigia deploy — e ela já estava
--      defasada: dizia que segunda não tem atendimento, enquanto existem
--      consultas gravadas na segunda às 19:00.
--
--   3. Não havia onde registrar ONDE o atendimento acontece, nem se é
--      presencial ou teleconsulta.
--
-- Aditiva e idempotente. Não altera nem remove nada existente: `tipo_ensaio`
-- continua sendo texto livre e os agendamentos antigos seguem válidos.
--
-- ⚠️ Rodar ANTES do deploy do código que lê estas tabelas.
-- ---------------------------------------------------------------------------

-- 1. Tipos de atendimento -----------------------------------------------------

create table if not exists public.appointment_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint appointment_types_name_not_blank check (btrim(name) <> '')
);

-- Parcial, igual a `procedures`: um nome arquivado não impede recriá-lo depois.
create unique index if not exists appointment_types_name_lower_uidx
  on public.appointment_types (lower(btrim(name)))
  where archived_at is null;

create index if not exists appointment_types_archived_at_idx
  on public.appointment_types (archived_at);

alter table public.appointment_types enable row level security;
revoke all on public.appointment_types from anon, authenticated;

-- 2. Unidades de atendimento --------------------------------------------------

create table if not exists public.clinic_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint clinic_units_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists clinic_units_name_lower_uidx
  on public.clinic_units (lower(btrim(name)))
  where archived_at is null;

alter table public.clinic_units enable row level security;
revoke all on public.clinic_units from anon, authenticated;

-- 3. Grade de horários por dia da semana --------------------------------------
--
-- Uma linha por dia (0 = domingo … 6 = sábado), com a lista ordenada de
-- horários sugeridos. Array e não tabela-filha de propósito: o dado é uma lista
-- curta lida e gravada sempre inteira, nunca consultada por item.
-- O formato "HH:MM" é validado no route handler, junto do resto do payload.

create table if not exists public.agenda_hours (
  weekday    smallint primary key,
  times      text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint agenda_hours_weekday_range check (weekday between 0 and 6)
);

alter table public.agenda_hours enable row level security;
revoke all on public.agenda_hours from anon, authenticated;

-- 4. Onde e como o atendimento acontece ---------------------------------------

alter table public.appointments
  add column if not exists modality text;

alter table public.appointments
  add column if not exists unit_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_modality_valid'
  ) then
    alter table public.appointments
      add constraint appointments_modality_valid
      check (modality is null or modality in ('presencial', 'teleconsulta'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'appointments_unit_id_fkey'
  ) then
    -- `set null`: arquivar/remover uma unidade não pode apagar o histórico de
    -- atendimento que aconteceu nela.
    alter table public.appointments
      add constraint appointments_unit_id_fkey
      foreign key (unit_id) references public.clinic_units (id) on delete set null;
  end if;
end $$;

create index if not exists appointments_unit_id_idx
  on public.appointments (unit_id);

-- 5. updated_at ---------------------------------------------------------------
-- `set_updated_at()` já existe desde 20260807120000_procedimentos_e_venda_atomica.

drop trigger if exists trg_appointment_types_updated_at on public.appointment_types;
create trigger trg_appointment_types_updated_at
  before update on public.appointment_types
  for each row execute function public.set_updated_at();

drop trigger if exists trg_clinic_units_updated_at on public.clinic_units;
create trigger trg_clinic_units_updated_at
  before update on public.clinic_units
  for each row execute function public.set_updated_at();

drop trigger if exists trg_agenda_hours_updated_at on public.agenda_hours;
create trigger trg_agenda_hours_updated_at
  before update on public.agenda_hours
  for each row execute function public.set_updated_at();

-- 6. Carga inicial ------------------------------------------------------------
--
-- `where not exists` em vez de `on conflict`: é legível, não depende de índice
-- parcial como alvo de conflito, e reaplica sem efeito.

insert into public.appointment_types (name)
select nome
from (values
  ('Primeira consulta'),
  ('Consulta'),
  ('Retorno'),
  ('Teleconsulta'),
  ('Visita de representante')
) as seed(nome)
where not exists (
  select 1 from public.appointment_types existente
  where lower(btrim(existente.name)) = lower(btrim(seed.nome))
    and existente.archived_at is null
);

-- A grade atual do código, transposta para o banco sem mudar comportamento.
-- Segunda e quinta entram VAZIAS, refletindo o que o código fazia; ajustar isso
-- é decisão da clínica, agora possível pela tela de configurações.
insert into public.agenda_hours (weekday, times)
select dia, horarios
from (values
  (0, '{}'::text[]),
  (1, '{}'::text[]),
  (2, '{14:00,15:00,16:00,17:00,18:00,19:00}'::text[]),
  (3, '{08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00}'::text[]),
  (4, '{}'::text[]),
  (5, '{08:00,09:00,10:00,11:00,12:00}'::text[]),
  (6, '{}'::text[])
) as seed(dia, horarios)
on conflict (weekday) do nothing;
