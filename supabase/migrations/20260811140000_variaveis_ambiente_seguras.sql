-- Variáveis de runtime gerenciadas pelo CRM.
--
-- O valor nunca fica em tabela pública: `app_environment_variables` guarda
-- apenas metadados, enquanto o segredo cifrado fica no Supabase Vault. As RPCs
-- são a única fronteira de escrita/leitura e só podem ser chamadas pelo
-- service_role.

create extension if not exists supabase_vault with schema vault;

create table if not exists public.app_environment_variables (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  secret_id  uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_environment_variables_name_key unique (name),
  constraint app_environment_variables_secret_id_key unique (secret_id),
  constraint app_environment_variables_name_format_check
    check (name ~ '^[A-Z][A-Z0-9_]{0,63}$')
);

comment on table public.app_environment_variables is
  'Metadados das variáveis de runtime administradas no CRM; valores ficam cifrados no Supabase Vault.';

alter table public.app_environment_variables enable row level security;

revoke all on public.app_environment_variables from anon, authenticated;
revoke all on public.app_environment_variables from service_role;
grant select on public.app_environment_variables to service_role;

create or replace function public.set_app_environment_variable(
  p_name text,
  p_value text,
  p_replace boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := upper(btrim(coalesce(p_name, '')));
  v_secret_id uuid;
begin
  if v_name !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception 'invalid_environment_variable_name'
      using errcode = '22023';
  end if;

  if p_value is null or length(p_value) = 0 or length(p_value) > 16384 then
    raise exception 'invalid_environment_variable_value'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_environment_variable:' || v_name, 0)
  );

  select variable.secret_id
    into v_secret_id
  from public.app_environment_variables as variable
  where variable.name = v_name
  for update;

  if v_secret_id is not null and not p_replace then
    raise exception 'environment_variable_already_exists'
      using errcode = '23505';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_value,
      'crm_suporte_app_env.' || v_name,
      'Gerenciada pelo CRM Suporte'
    );

    insert into public.app_environment_variables (name, secret_id)
    values (v_name, v_secret_id);
  else
    perform vault.update_secret(
      v_secret_id,
      p_value,
      'crm_suporte_app_env.' || v_name,
      'Gerenciada pelo CRM Suporte'
    );

    update public.app_environment_variables
    set updated_at = now()
    where name = v_name;
  end if;

  return true;
end;
$$;

create or replace function public.get_app_environment_variable(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted.decrypted_secret
  from public.app_environment_variables as variable
  join vault.decrypted_secrets as decrypted
    on decrypted.id = variable.secret_id
  where variable.name = upper(btrim(coalesce(p_name, '')))
  limit 1;
$$;

create or replace function public.delete_app_environment_variable(p_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := upper(btrim(coalesce(p_name, '')));
  v_secret_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_environment_variable:' || v_name, 0)
  );

  delete from public.app_environment_variables as variable
  where variable.name = v_name
  returning variable.secret_id into v_secret_id;

  if v_secret_id is null then
    return false;
  end if;

  delete from vault.secrets
  where id = v_secret_id;

  return true;
end;
$$;

revoke execute on function public.set_app_environment_variable(text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.get_app_environment_variable(text)
  from public, anon, authenticated;
revoke execute on function public.delete_app_environment_variable(text)
  from public, anon, authenticated;

grant execute on function public.set_app_environment_variable(text, text, boolean)
  to service_role;
grant execute on function public.get_app_environment_variable(text)
  to service_role;
grant execute on function public.delete_app_environment_variable(text)
  to service_role;
