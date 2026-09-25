-- Gestão de usuários avançada:
--  1. admin pode exigir troca de senha ao REDEFINIR a senha de outro usuário;
--  2. admin pode EXCLUIR (hard delete) qualquer usuário, inclusive outro admin,
--     preservando as travas de "último admin ativo" e "não excluir a si mesmo".

-- ---------------------------------------------------------------------------
-- reset_app_user_password ganha p_must_change_password COM DEFAULT NULL:
--   - null (código antigo, 3 args) → mantém o flag como está;
--   - true                          → força troca no próximo login (senha temp);
--   - false                         → limpa a exigência (senha definitiva).
--   - self-change (actor = alvo)    → sempre limpa (o usuário escolheu a senha).
-- Assinatura muda, mas o DEFAULT resolve a chamada antiga → sem janela de quebra.
-- ---------------------------------------------------------------------------
drop function if exists public.reset_app_user_password(uuid, uuid, text);
create function public.reset_app_user_password(
  p_actor_id uuid,
  p_id uuid,
  p_password text,
  p_must_change_password boolean default null
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
         must_change_password = case
           when p_actor_id = p_id then false
           else coalesce(p_must_change_password, must_change_password)
         end,
         updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using detail = 'Usuário não encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_app_user: hard delete. Só admin; não a si mesmo; nunca o último admin
-- ativo. Como NENHUMA FK aponta para app_users, limpamos as referências lógicas
-- (autor de token, remetente de mensagem) antes de remover, evitando ids órfãos.
-- ---------------------------------------------------------------------------
create function public.delete_app_user(p_actor_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.app_users%rowtype;
  v_target public.app_users%rowtype;
  v_other_admins integer;
begin
  select * into v_actor from public.app_users where id = p_actor_id and is_active;
  if v_actor.id is null then
    raise exception 'UNAUTHORIZED' using detail = 'Sessão sem acesso.';
  end if;
  if v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using detail = 'Apenas administradores podem excluir usuários.';
  end if;

  select * into v_target from public.app_users where id = p_id;
  if v_target.id is null then
    raise exception 'USER_NOT_FOUND' using detail = 'Usuário não encontrado.';
  end if;

  if p_actor_id = p_id then
    raise exception 'SELF_DELETE' using detail = 'Você não pode excluir a própria conta.';
  end if;

  if v_target.role = 'admin' and v_target.is_active then
    select count(*) into v_other_admins
    from public.app_users
    where id <> p_id and role = 'admin' and is_active;
    if v_other_admins = 0 then
      raise exception 'LAST_ACTIVE_ADMIN' using detail = 'Deve haver ao menos um administrador ativo.';
    end if;
  end if;

  -- Referências lógicas (sem FK): não deixar id apontando para linha inexistente.
  update public.api_tokens set created_by = null where created_by = p_id;
  update public.chat_messages set sent_by_user_id = null where sent_by_user_id = p_id;

  delete from public.app_users where id = p_id;
end;
$$;

-- Permissões: só service_role executa (as rotas usam a service key).
revoke all on function public.reset_app_user_password(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.reset_app_user_password(uuid, uuid, text, boolean)
  to service_role;
revoke all on function public.delete_app_user(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_app_user(uuid, uuid)
  to service_role;
