-- ============================================================================
-- Notas do usuário — o bloco "Minhas notas" da tela de Início.
--
-- Duas naturezas na MESMA tabela, separadas por `kind`:
--   quick  → o lembrete rápido, UM por usuário (índice único parcial garante)
--   sticky → os post-its, N por usuário
--
-- É dado do próprio usuário: `user_id` referencia app_users e cai junto com ele.
-- RLS ligada e sem policy para anon/authenticated — o acesso é server-side com
-- service role, como todo o resto do app (AGENTS §3.1).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  kind text not null default 'sticky',
  title text,
  content text not null default '',
  color text not null default 'amber',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_notes_kind_check'
  ) then
    alter table public.user_notes
      add constraint user_notes_kind_check check (kind in ('quick', 'sticky'));
  end if;
end
$$;

-- Um único lembrete rápido por usuário: o índice é a regra, não a aplicação.
create unique index if not exists user_notes_one_quick_per_user
  on public.user_notes (user_id)
  where kind = 'quick';

create index if not exists idx_user_notes_user_kind
  on public.user_notes (user_id, kind, position, created_at desc);

alter table public.user_notes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_notes' and policyname = 'user_notes_service_role_all'
  ) then
    create policy user_notes_service_role_all
      on public.user_notes for all
      to service_role
      using (true) with check (true);
  end if;
end
$$;

grant all on public.user_notes to service_role;

-- `updated_at` é o carimbo que a UI mostra ("Atualizado em…"): não pode depender
-- de a aplicação lembrar de enviá-lo.
create or replace function public.touch_user_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_notes_updated_at on public.user_notes;
create trigger trg_user_notes_updated_at
  before update on public.user_notes
  for each row execute function public.touch_user_notes_updated_at();
