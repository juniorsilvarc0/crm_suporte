-- ============================================================================
-- Bootstrap do Postgres LOCAL (docker compose, sem o stack do CLI da Supabase).
-- Roda uma única vez, na criação do volume, antes de qualquer migration.
--
-- Supre o que o stack completo criaria e as migrations pressupõem:
--   1) publication `supabase_realtime` (no stack completo quem cria é o Realtime)
--   2) shim do schema `storage` (sem storage-api local, as migrations só fazem
--      INSERT em storage.buckets — upload de mídia não funciona em dev local)
-- ============================================================================

-- No stack completo, um init da Supabase sincroniza a senha dos papéis internos
-- com POSTGRES_PASSWORD; aqui fazemos direto (o PostgREST conecta como
-- authenticator, papel reservado que só o superusuário supabase_admin altera).
set role supabase_admin;
alter role authenticator with login password 'postgres';
reset role;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets to service_role;
