-- ---------------------------------------------------------------------------
-- Bloqueio de datas e horários na agenda.
--
-- Contexto: a grade de `agenda_hours` diz o que é expediente NORMAL, semana a
-- semana. Ela não sabe dizer "dia 20 eu estou em congresso" nem "quinta que vem
-- das 14h às 16h tenho cirurgia". Sem isso, o horário continuava sendo
-- oferecido pelos atalhos e nada avisava quem estava marcando.
--
-- Um bloqueio é um INTERVALO, não uma regra recorrente. Recorrência já existe e
-- é a grade: dia da semana sem horário nenhum é dia sem atendimento. Duas
-- formas de dizer a mesma coisa divergiriam na primeira mudança de expediente.
--
-- Aditiva e idempotente. Não altera nada existente.
--
-- ⚠️ Rodar ANTES do deploy do código que lê esta tabela.
-- ---------------------------------------------------------------------------

create table if not exists public.agenda_blocks (
  id                 uuid primary key default gen_random_uuid(),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  -- `all_day` é apresentação, não regra: o intervalo já cobre o dia inteiro.
  -- Guardar a intenção evita a tela ter que adivinhar, a partir de 00:00–23:59,
  -- se quem cadastrou queria "o dia todo" ou uma faixa que por acaso bate.
  all_day            boolean not null default false,
  reason             text,
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint agenda_blocks_range_valid check (ends_at > starts_at)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agenda_blocks_created_by_user_id_fkey'
  ) then
    -- `set null`: remover um usuário não pode apagar o bloqueio que ele criou.
    alter table public.agenda_blocks
      add constraint agenda_blocks_created_by_user_id_fkey
      foreign key (created_by_user_id) references public.app_users (id) on delete set null;
  end if;
end $$;

-- A consulta é sempre "o que bloqueia esta janela": ordenar por início cobre
-- tanto a listagem quanto o recorte por período.
create index if not exists agenda_blocks_starts_at_idx
  on public.agenda_blocks (starts_at);

create index if not exists agenda_blocks_ends_at_idx
  on public.agenda_blocks (ends_at);

alter table public.agenda_blocks enable row level security;
revoke all on public.agenda_blocks from anon, authenticated;

drop trigger if exists trg_agenda_blocks_updated_at on public.agenda_blocks;
create trigger trg_agenda_blocks_updated_at
  before update on public.agenda_blocks
  for each row execute function public.set_updated_at();
