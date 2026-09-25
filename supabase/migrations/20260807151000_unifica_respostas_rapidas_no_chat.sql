-- Corrige a fonte de verdade das respostas rápidas.
-- `chat_quick_replies` já existia desde o módulo de chat; a migration anterior
-- criou `quick_replies` em paralelo. Esta migration amplia a tabela original,
-- migra qualquer linha criada no intervalo e remove a duplicata.

alter table public.chat_quick_replies
  add column if not exists title text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by_user_id uuid
    references public.app_users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.chat_quick_replies
set title = shortcut
where title is null or btrim(title) = '';

alter table public.chat_quick_replies alter column title set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_quick_replies_title_not_blank'
  ) then
    alter table public.chat_quick_replies
      add constraint chat_quick_replies_title_not_blank check (btrim(title) <> '');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'chat_quick_replies_title_length'
  ) then
    alter table public.chat_quick_replies
      add constraint chat_quick_replies_title_length check (char_length(title) <= 80);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'chat_quick_replies_shortcut_format'
  ) then
    alter table public.chat_quick_replies
      add constraint chat_quick_replies_shortcut_format check (shortcut ~ '^[a-z0-9_-]{1,40}$');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'chat_quick_replies_content_not_blank'
  ) then
    alter table public.chat_quick_replies
      add constraint chat_quick_replies_content_not_blank check (btrim(content) <> '');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'chat_quick_replies_content_length'
  ) then
    alter table public.chat_quick_replies
      add constraint chat_quick_replies_content_length check (char_length(content) <= 4000);
  end if;
end;
$$;

create unique index if not exists chat_quick_replies_shortcut_lower_uidx
  on public.chat_quick_replies (lower(shortcut));
create index if not exists chat_quick_replies_active_title_idx
  on public.chat_quick_replies (is_active, lower(title));
create index if not exists chat_quick_replies_created_by_user_id_idx
  on public.chat_quick_replies (created_by_user_id);

alter table public.chat_quick_replies enable row level security;
revoke all on public.chat_quick_replies from anon, authenticated;

drop trigger if exists trg_chat_quick_replies_set_updated_at on public.chat_quick_replies;
create trigger trg_chat_quick_replies_set_updated_at
  before update on public.chat_quick_replies
  for each row execute function public.set_updated_at();

do $$
begin
  if to_regclass('public.quick_replies') is not null then
    insert into public.chat_quick_replies (
      id, title, shortcut, content, is_active,
      created_by_user_id, created_at, updated_at
    )
    select
      id, title, shortcut, content, is_active,
      created_by_user_id, created_at, updated_at
    from public.quick_replies
    on conflict (shortcut) do update set
      title = excluded.title,
      content = excluded.content,
      is_active = excluded.is_active,
      created_by_user_id = excluded.created_by_user_id,
      updated_at = excluded.updated_at;

    drop table public.quick_replies;
  end if;
end;
$$;
