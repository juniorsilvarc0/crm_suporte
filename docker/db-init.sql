-- ============================================================================
-- Bootstrap do Postgres LOCAL (docker compose, sem o stack do CLI da Supabase).
-- Roda uma única vez, na criação do volume, antes de qualquer migration.
--
-- Supre o que o stack oficial faria e este compose não monta — as mesmas
-- armadilhas que custaram a subida da produção de origem (ver PROGRESS):
--   1) senha dos papéis internos igual à que os serviços usam para conectar;
--   2) schema `_realtime`, onde o Realtime roda as próprias migrations;
--   3) publication `supabase_realtime` — sem ela o Realtime não emite nada,
--      em silêncio.
-- O schema `storage` NÃO é criado aqui: quem cria é o storage-api, ao subir.
-- ============================================================================

-- `postgres` não é superusuário nesta imagem e `authenticator` é papel
-- reservado: só supabase_admin altera.
set role supabase_admin;
alter role authenticator          with login password 'postgres';
alter role supabase_admin         with login password 'postgres';
alter role supabase_storage_admin with login password 'postgres';

-- As migrations rodam como `postgres`, que não é membro de supabase_admin e
-- não alcança os default privileges DELE — abertos na imagem para anon,
-- authenticated e service_role. Fecha aqui, onde já somos supabase_admin. O
-- EXECUTE que PUBLIC recebe fica: tirá-lo quebraria as funções de extensão
-- (ex.: extensions.crypt, do login); o assert do baseline vigia o resto.
alter default privileges for role supabase_admin in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated, service_role;
reset role;

create schema if not exists _realtime authorization postgres;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
