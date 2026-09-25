-- Papéis e perfil visual dos usuários do dashboard.
alter table public.app_users
  add column if not exists role text not null default 'member',
  add column if not exists avatar_url text,
  add column if not exists avatar_color text not null default 'slate';

alter table public.app_users
  drop constraint if exists app_users_role_check;
alter table public.app_users
  add constraint app_users_role_check check (role in ('admin', 'member'));

-- Instalações existentes precisam começar com ao menos um administrador.
update public.app_users
set role = 'admin', updated_at = now()
where id = (
  select id
  from public.app_users
  where is_active
  order by created_at asc
  limit 1
)
and not exists (
  select 1 from public.app_users where role = 'admin' and is_active
);

drop function if exists public.verify_login(text, text);
create function public.verify_login(p_email text, p_password text)
returns table (
  id uuid,
  email text,
  name text,
  role text,
  avatar_url text,
  avatar_color text
)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.email, u.name, u.role, u.avatar_url, u.avatar_color
  from public.app_users u
  where lower(u.email) = lower(trim(p_email))
    and u.is_active
    and u.password_hash = extensions.crypt(p_password, u.password_hash);
$$;

drop function if exists public.create_app_user(text, text, text);
create function public.create_app_user(
  p_email text,
  p_name text,
  p_password text,
  p_role text,
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
  v_email text := lower(trim(p_email));
  v_name text := trim(p_name);
  v_role text := lower(trim(p_role));
  v_color text := coalesce(nullif(trim(p_avatar_color), ''), 'slate');
begin
  if v_email = '' or v_name = '' then
    raise exception 'INVALID_INPUT' using detail = 'Email e nome são obrigatórios.';
  end if;
  if v_role not in ('admin', 'member') then
    raise exception 'INVALID_ROLE' using detail = 'Papel inválido.';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'WEAK_PASSWORD' using detail = 'A senha deve ter ao menos 8 caracteres.';
  end if;

  return query
  insert into public.app_users (email, name, password_hash, role, avatar_color)
  values (
    v_email,
    v_name,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_role,
    v_color
  )
  returning app_users.id, app_users.email, app_users.name, app_users.role,
            app_users.avatar_url, app_users.avatar_color,
            app_users.is_active, app_users.created_at;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

drop function if exists public.update_app_user(uuid, uuid, text, text, boolean);
create function public.update_app_user(
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
  select * into v_actor from public.app_users where app_users.id = p_actor_id and is_active;
  select * into v_target from public.app_users where app_users.id = p_id;

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

  -- Membros editam identidade e foto, nunca papel ou acesso.
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

drop function if exists public.reset_app_user_password(uuid, text);
create function public.reset_app_user_password(
  p_actor_id uuid,
  p_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.app_users%rowtype;
begin
  select * into v_actor from public.app_users where id = p_actor_id and is_active;
  if v_actor.id is null then
    raise exception 'UNAUTHORIZED' using detail = 'Sessão sem acesso.';
  end if;
  if v_actor.role <> 'admin' and p_actor_id <> p_id then
    raise exception 'FORBIDDEN' using detail = 'Você só pode alterar a própria senha.';
  end if;
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

revoke all on function public.verify_login(text, text) from public, anon, authenticated;
revoke all on function public.create_app_user(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.reset_app_user_password(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.verify_login(text, text) to service_role;
grant execute on function public.create_app_user(text, text, text, text, text) to service_role;
grant execute on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text) to service_role;
grant execute on function public.reset_app_user_password(uuid, uuid, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
