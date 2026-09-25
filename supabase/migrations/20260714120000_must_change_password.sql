-- Troca de senha obrigatória no primeiro acesso.
--
-- Um admin pode criar um usuário com uma senha temporária e marcar que ele deve
-- definir a própria senha antes de usar o sistema. O flag mora no banco (não no
-- JWT), então é lido fresco a cada navegação — rebaixar/forçar vale na hora.

alter table public.app_users
  add column if not exists must_change_password boolean not null default false;

-- ---------------------------------------------------------------------------
-- create_app_user ganha p_must_change_password. O parâmetro tem DEFAULT, então
-- o código antigo (que chama sem ele) continua resolvendo para esta função —
-- sem janela de quebra no deploy.
-- ---------------------------------------------------------------------------
drop function if exists public.create_app_user(text, text, text, text, text);
create function public.create_app_user(
  p_email text,
  p_name text,
  p_password text,
  p_role text,
  p_avatar_color text,
  p_must_change_password boolean default false
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
  insert into public.app_users (email, name, password_hash, role, avatar_color, must_change_password)
  values (
    v_email,
    v_name,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    v_role,
    v_color,
    coalesce(p_must_change_password, false)
  )
  returning app_users.id, app_users.email, app_users.name, app_users.role,
            app_users.avatar_url, app_users.avatar_color,
            app_users.is_active, app_users.created_at;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

-- ---------------------------------------------------------------------------
-- reset_app_user_password: quando o usuário troca a PRÓPRIA senha (self), o
-- flag de "precisa trocar" é limpo — ele já escolheu a senha dele. Mesma
-- assinatura, então create or replace não quebra nada no deploy.
-- ---------------------------------------------------------------------------
create or replace function public.reset_app_user_password(
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
         -- Trocar a própria senha satisfaz a exigência de primeiro acesso.
         must_change_password = case
           when p_actor_id = p_id then false
           else must_change_password
         end,
         updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using detail = 'Usuário não encontrado.';
  end if;
end;
$$;

-- Permissões: só service_role executa (as rotas usam a service key).
revoke all on function public.create_app_user(text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_app_user(text, text, text, text, text, boolean)
  to service_role;
