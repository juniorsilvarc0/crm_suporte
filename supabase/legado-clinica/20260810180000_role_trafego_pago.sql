-- Papel restrito para operadores de mídia paga.
-- Mantém os papéis existentes e libera somente o novo valor `paid_traffic`.

alter table public.app_users
  drop constraint if exists app_users_role_check;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('admin', 'member', 'paid_traffic'));

create or replace function public.create_app_user(
  p_email text,
  p_name text,
  p_password text,
  p_role text,
  p_avatar_color text,
  p_must_change_password boolean default false,
  p_apelido_atendimento text default null,
  p_assinar_mensagens boolean default true
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
  v_email text := lower(trim(p_email));
  v_name text := trim(p_name);
  v_role text := lower(trim(p_role));
  v_color text := coalesce(nullif(trim(p_avatar_color), ''), 'slate');
  v_apelido text := nullif(trim(coalesce(p_apelido_atendimento, '')), '');
begin
  if v_email = '' or v_name = '' then
    raise exception 'INVALID_INPUT' using detail = 'Email e nome são obrigatórios.';
  end if;
  if v_role not in ('admin', 'member', 'paid_traffic') then
    raise exception 'INVALID_ROLE' using detail = 'Papel inválido.';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'WEAK_PASSWORD' using detail = 'A senha deve ter ao menos 8 caracteres.';
  end if;

  return query
  insert into public.app_users (
    email, name, password_hash, role, avatar_color,
    must_change_password, apelido_atendimento, assinar_mensagens
  )
  values (
    v_email,
    v_name,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_role,
    v_color,
    coalesce(p_must_change_password, false),
    v_apelido,
    coalesce(p_assinar_mensagens, true)
  )
  returning app_users.id, app_users.email, app_users.name, app_users.role,
            app_users.avatar_url, app_users.avatar_color,
            app_users.is_active, app_users.created_at;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

create or replace function public.update_app_user(
  p_actor_id uuid,
  p_id uuid,
  p_name text,
  p_email text,
  p_is_active boolean,
  p_role text,
  p_avatar_url text,
  p_avatar_color text,
  p_apelido_atendimento text default null,
  p_assinar_mensagens boolean default null
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
  if v_role not in ('admin', 'member', 'paid_traffic') then
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
         apelido_atendimento = case
           when p_apelido_atendimento is null then u.apelido_atendimento
           else nullif(trim(p_apelido_atendimento), '')
         end,
         assinar_mensagens = coalesce(p_assinar_mensagens, u.assinar_mensagens),
         updated_at = now()
   where u.id = p_id
  returning u.id, u.email, u.name, u.role, u.avatar_url, u.avatar_color,
            u.is_active, u.created_at;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

revoke all on function public.create_app_user(text, text, text, text, text, boolean, text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_app_user(text, text, text, text, text, boolean, text, boolean)
  to service_role;

revoke all on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text, text, boolean)
  to service_role;
