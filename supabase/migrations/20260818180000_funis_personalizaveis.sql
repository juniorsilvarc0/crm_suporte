-- ============================================================================
-- FUNIS PERSONALIZÁVEIS
--
-- Até aqui existia UM funil: `board_columns` (as etapas) + `deals` (os cards),
-- e ele é especial — move o status do lead, alimenta conversão e o CAPI da
-- Meta, e tem 5 gatilhos que pressupõem `deals.lead_id` preenchido.
--
-- A clínica precisa de OUTROS funis: processos internos, jornada de
-- atendimento, obras, o que for. Nesses, o card pode não ter pessoa nenhuma.
--
-- DESENHO (deliberado, para não desestabilizar o que já funciona):
--   • `pipelines` — a lista de funis. O primeiro, `kind = 'leads'`, representa
--     o funil que já existe.
--   • `board_columns.pipeline_id` — as etapas passam a pertencer a um funil.
--     A chave da etapa deixa de ser única global e passa a ser única POR funil
--     (dois funis podem ter "novo").
--   • `pipeline_cards` — os cards dos funis personalizados, com lead e paciente
--     OPCIONAIS. `deals` fica intocado: continua sendo a oportunidade do lead,
--     com toda a mecânica de conversão que depende dela.
--
-- Ou seja: nenhum gatilho existente muda de comportamento.
-- ============================================================================

create extension if not exists pgcrypto;

-- --- Funis --------------------------------------------------------------------
create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  -- Cor da marca do funil (nome de cor do design system, não hex).
  color text not null default 'sky',
  -- 'leads' é o funil nativo (cards = deals). 'custom' são os criados aqui.
  kind text not null default 'custom',
  is_default boolean not null default false,
  position integer not null default 0,
  archived_at timestamptz,
  created_by_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipelines_kind_check') then
    alter table public.pipelines add constraint pipelines_kind_check
      check (kind in ('leads', 'custom'));
  end if;
end
$$;

-- Só um funil nativo de leads pode existir: ele é a âncora do que já roda.
create unique index if not exists pipelines_single_leads_kind
  on public.pipelines (kind)
  where kind = 'leads';

create index if not exists idx_pipelines_position on public.pipelines (position, created_at);

drop trigger if exists trg_pipelines_set_updated_at on public.pipelines;
create trigger trg_pipelines_set_updated_at
  before update on public.pipelines
  for each row execute function public.set_updated_at();

-- O funil que já existe ganha registro, para poder ser listado ao lado dos novos.
insert into public.pipelines (name, description, kind, is_default, position, color)
select 'Funil de leads', 'Quem chegou pelo WhatsApp, da primeira conversa ao atendimento.', 'leads', true, 0, 'sky'
where not exists (select 1 from public.pipelines where kind = 'leads');

-- --- Etapas passam a pertencer a um funil ------------------------------------
alter table public.board_columns
  add column if not exists pipeline_id uuid references public.pipelines (id) on delete cascade;

update public.board_columns
   set pipeline_id = (select id from public.pipelines where kind = 'leads')
 where pipeline_id is null;

alter table public.board_columns
  alter column pipeline_id set not null;

-- A chave da etapa era única no banco inteiro; agora é única DENTRO do funil.
alter table public.board_columns drop constraint if exists board_columns_key_key;
create unique index if not exists board_columns_pipeline_key_uidx
  on public.board_columns (pipeline_id, key);
create index if not exists idx_board_columns_pipeline
  on public.board_columns (pipeline_id, position);

-- --- Cards dos funis personalizados ------------------------------------------
-- Card pode ou não estar atrelado a uma pessoa. Sem pessoa, o título é quem
-- identifica o cartão — por isso `title` é obrigatório aqui (em `deals` o
-- título é opcional porque o lead sempre dá nome ao card).
create table if not exists public.pipeline_cards (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  -- Etapa: a `key` da coluna DENTRO deste funil.
  stage text not null,
  title text not null,
  description text,
  -- Vínculos OPCIONAIS: o card pode ser de processo interno, sem pessoa.
  lead_id uuid references public.leads (id) on delete set null,
  patient_id uuid references public.patients (id) on delete set null,
  amount numeric(12, 2),
  due_at timestamptz,
  assigned_to_user_id uuid references public.app_users (id) on delete set null,
  position integer not null default 0,
  archived_at timestamptz,
  created_by_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pipeline_cards_board
  on public.pipeline_cards (pipeline_id, stage, position)
  where archived_at is null;
create index if not exists idx_pipeline_cards_lead on public.pipeline_cards (lead_id) where lead_id is not null;
create index if not exists idx_pipeline_cards_patient on public.pipeline_cards (patient_id) where patient_id is not null;

drop trigger if exists trg_pipeline_cards_set_updated_at on public.pipeline_cards;
create trigger trg_pipeline_cards_set_updated_at
  before update on public.pipeline_cards
  for each row execute function public.set_updated_at();

-- Card só existe dentro de uma etapa REAL do próprio funil. Sem isto, mover um
-- card para uma etapa de outro funil (ou apagar a etapa) deixaria o cartão
-- órfão numa coluna que a tela não desenha.
create or replace function public.pipeline_cards_check_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.board_columns
     where pipeline_id = new.pipeline_id
       and key = new.stage
  ) then
    raise exception 'etapa_inexistente_no_funil'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.pipeline_cards_check_stage()
  from public, anon, authenticated;

drop trigger if exists trg_pipeline_cards_check_stage on public.pipeline_cards;
create trigger trg_pipeline_cards_check_stage
  before insert or update of stage, pipeline_id on public.pipeline_cards
  for each row execute function public.pipeline_cards_check_stage();

-- --- Segurança ---------------------------------------------------------------
alter table public.pipelines enable row level security;
alter table public.pipeline_cards enable row level security;
revoke all on public.pipelines from anon, authenticated;
revoke all on public.pipeline_cards from anon, authenticated;
grant all on public.pipelines to service_role;
grant all on public.pipeline_cards to service_role;
