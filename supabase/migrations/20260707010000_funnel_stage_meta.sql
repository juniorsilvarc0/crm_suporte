-- Metadados OPCIONAIS das etapas do funil (estilo "Pipelines & Etapas"):
-- probabilidade (%) e situação (Aberto/Ganho/Perdido). A exibição no funil é
-- controlada por um toggle global em app_settings.

-- 1) Colunas novas em board_columns.
alter table public.board_columns
  add column if not exists probability integer,
  add column if not exists stage_type text not null default 'open';

alter table public.board_columns
  drop constraint if exists board_columns_stage_type_check;
alter table public.board_columns
  add constraint board_columns_stage_type_check
  check (stage_type in ('open', 'won', 'lost'));

-- 2) Backfill das 8 etapas canônicas (probabilidade só quando ainda nula).
update public.board_columns set probability = 10  where key = 'novo'           and probability is null;
update public.board_columns set probability = 25  where key = 'em_atendimento' and probability is null;
update public.board_columns set probability = 40  where key = 'qualificado'    and probability is null;
update public.board_columns set probability = 60  where key = 'agendado'       and probability is null;
update public.board_columns set probability = 80  where key = 'compareceu'     and probability is null;
update public.board_columns set probability = 100 where key = 'cliente'        and probability is null;
update public.board_columns set probability = 100 where key = 'recorrente'     and probability is null;
update public.board_columns set probability = 0   where key = 'perdido'        and probability is null;

-- Situação: cliente/recorrente = ganho, perdido = perdido, resto = aberto.
update public.board_columns set stage_type = 'won'  where key in ('cliente', 'recorrente');
update public.board_columns set stage_type = 'lost' where key = 'perdido';

-- 3) Configurações globais do app (chave/valor). Acesso só via service_role.
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Toggle do funil (começa desligado — os metadados são opcionais).
insert into public.app_settings (key, value)
  values ('funnel', jsonb_build_object('showStageMeta', false))
  on conflict (key) do nothing;
