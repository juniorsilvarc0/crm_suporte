-- Corrige ambiguidade entre a coluna is_active e a coluna de saída da função.
create or replace function public.update_app_user(
  p_actor_id uuid,
  p_id uuid,
  p_name text,
  p_email text,
  p_is_active boolean,
  p_role text,
  p_avatar_url text,
  p_avatar_color text
)
returns table (
  id uuid,
  email text,
  name text,
  role text,
  avatar_url text,
  avatar_color text,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.app_users%rowtype;
  v_target public.app_users%rowtype;
  v_email text := lower(trim(p_email));
  v_name text := trim(p_name);
  v_role text := lower(trim(p_role));
  v_color text := coalesce(nullif(trim(p_avatar_color), ''), 'slate');
  v_other_admins integer;
begin
  select au.* into v_actor
  from public.app_users au
  where au.id = p_actor_id and au.is_active;

  select au.* into v_target
  from public.app_users au
  where au.id = p_id;

  if v_actor.id is null then
    raise exception 'UNAUTHORIZED' using detail = 'Sessão sem acesso.';
  end if;
  if v_target.id is null then
    raise exception 'USER_NOT_FOUND' using detail = 'Usuário não encontrado.';
  end if;
  if v_actor.role <> 'admin' and p_actor_id <> p_id then
    raise exception 'FORBIDDEN' using detail = 'Você só pode editar o próprio perfil.';
  end if;
  if v_email = '' or v_name = '' then
    raise exception 'INVALID_INPUT' using detail = 'Email e nome são obrigatórios.';
  end if;
  if v_role not in ('admin', 'member') then
    raise exception 'INVALID_ROLE' using detail = 'Papel inválido.';
  end if;
  if v_actor.role <> 'admin' and (v_role <> v_target.role or p_is_active <> v_target.is_active) then
    raise exception 'FORBIDDEN' using detail = 'Você não pode alterar papel ou acesso.';
  end if;
  if p_actor_id = p_id and (p_is_active = false or v_role <> v_target.role) then
    raise exception 'SELF_ROLE_CHANGE' using detail = 'Você não pode remover o próprio acesso ou papel.';
  end if;

  if v_target.role = 'admin' and v_target.is_active
     and (p_is_active = false or v_role <> 'admin') then
    select count(*) into v_other_admins
    from public.app_users au
    where au.id <> p_id and au.role = 'admin' and au.is_active;
    if v_other_admins = 0 then
      raise exception 'LAST_ACTIVE_ADMIN' using detail = 'Deve haver ao menos um administrador ativo.';
    end if;
  end if;

  return query
  update public.app_users u
     set name = v_name,
         email = v_email,
         is_active = p_is_active,
         role = v_role,
         avatar_url = nullif(trim(p_avatar_url), ''),
         avatar_color = v_color,
         updated_at = now()
   where u.id = p_id
  returning u.id, u.email, u.name, u.role, u.avatar_url, u.avatar_color,
            u.is_active, u.created_at;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

revoke all on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text)
  to service_role;
