-- ============================================================================
-- Gestão de usuários do dashboard (CRUD). Mesmo padrão do verify_login:
-- SECURITY DEFINER, search_path vazio, identificadores qualificados por schema,
-- hash bcrypt via pgcrypto e grant EXCLUSIVO ao service_role. As travas de
-- segurança ficam no BANCO (não dá para burlar por uma rota que esqueça a
-- checagem): não se auto-desativar, não desativar o último usuário ativo,
-- email único e senha com no mínimo 8 caracteres.
-- ============================================================================

-- (a) CRIAR usuário com senha (hash bcrypt com salt novo).
create or replace function public.create_app_user(
  p_email text,
  p_name text,
  p_password text
)
returns table (id uuid, email text, name text, is_active boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_name  text := trim(p_name);
begin
  if v_email = '' or v_name = '' then
    raise exception 'INVALID_INPUT' using detail = 'Email e nome são obrigatórios.';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'WEAK_PASSWORD' using detail = 'A senha deve ter ao menos 8 caracteres.';
  end if;

  return query
  insert into public.app_users (email, name, password_hash)
  values (v_email, v_name, extensions.crypt(p_password, extensions.gen_salt('bf')))
  returning app_users.id, app_users.email, app_users.name,
            app_users.is_active, app_users.created_at;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

-- (b) ATUALIZAR nome/email/is_active com travas de self-lockout e último ativo.
-- p_actor_id = id do usuário logado (vem do JWT) para barrar auto-desativação.
create or replace function public.update_app_user(
  p_actor_id uuid,
  p_id uuid,
  p_name text,
  p_email text,
  p_is_active boolean
)
returns table (id uuid, email text, name text, is_active boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_name  text := trim(p_name);
  v_other_active int;
begin
  if v_email = '' or v_name = '' then
    raise exception 'INVALID_INPUT' using detail = 'Email e nome são obrigatórios.';
  end if;

  if p_is_active = false and p_actor_id = p_id then
    raise exception 'SELF_DEACTIVATE' using detail = 'Você não pode desativar a si mesmo.';
  end if;

  if p_is_active = false then
    -- Alias explícito: os nomes das colunas do RETURNS TABLE (id, is_active...)
    -- colidem com as colunas da tabela; qualificar evita "column ambiguous".
    select count(*) into v_other_active
    from public.app_users au
    where au.is_active and au.id <> p_id;
    if v_other_active = 0 then
      raise exception 'LAST_ACTIVE_USER' using detail = 'Deve haver ao menos um usuário ativo.';
    end if;
  end if;

  return query
  update public.app_users u
     set name = v_name,
         email = v_email,
         is_active = p_is_active,
         updated_at = now()
   where u.id = p_id
  returning u.id, u.email, u.name, u.is_active, u.created_at;

  if not found then
    raise exception 'USER_NOT_FOUND' using detail = 'Usuário não encontrado.';
  end if;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

-- (c) RESETAR senha (hash bcrypt com salt novo).
create or replace function public.reset_app_user_password(
  p_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_password is null or length(p_password) < 8 then
    raise exception 'WEAK_PASSWORD' using detail = 'A senha deve ter ao menos 8 caracteres.';
  end if;

  update public.app_users
     set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using detail = 'Usuário não encontrado.';
  end if;
end;
$$;

-- ---- Grants: exclusivos ao service_role, igual ao verify_login --------------
revoke all on function public.create_app_user(text, text, text)                 from public, anon, authenticated;
revoke all on function public.update_app_user(uuid, uuid, text, text, boolean)   from public, anon, authenticated;
revoke all on function public.reset_app_user_password(uuid, text)                from public, anon, authenticated;

grant execute on function public.create_app_user(text, text, text)               to service_role;
grant execute on function public.update_app_user(uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.reset_app_user_password(uuid, text)             to service_role;
