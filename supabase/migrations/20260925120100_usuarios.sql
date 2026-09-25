-- ============================================================================
-- USUÁRIOS DO DASHBOARD: login, papéis e gestão da equipe.
--
-- Porta o estado FINAL destas migrations da origem (supabase/legado-clinica/):
--   20260703000000_app_users.sql                          tabela, bcrypt, verify_login
--   20260706000000_app_users_management.sql               CRUD com travas no banco
--   20260713150000_app_user_roles_and_profiles.sql        papel, avatar, último admin
--   20260713153000_fix_update_app_user_qualification.sql  alias contra "column ambiguous"
--   20260714120000_must_change_password.sql               troca obrigatória no 1º acesso
--   20260714150000_gestao_usuarios_avancada.sql           reset com flag, delete_app_user
--   20260714180000_apelido_e_assinatura_chat.sql          apelido e assinatura
--   20260810180000_role_trafego_pago.sql                  NÃO portado: `paid_traffic` saiu
--   20260819120000_blindagem_anon.sql                     revoke de PUBLIC nas funções
--
-- A autenticação não é Supabase Auth: é um JWT próprio (cookie) emitido depois
-- de `verify_login`. A senha só existe como hash bcrypt, e o hash não sai do
-- banco: nem o service_role o lê (grant por coluna, seção 3).
--
-- As travas moram no BANCO, não na rota: uma rota que esqueça a checagem não
-- consegue desativar o último admin, nem deixar alguém se autodesativar ou se
-- rebaixar (origem: 20260706000000, cabeçalho).
--
-- Diferenças deliberadas em relação à origem (a assinatura das RPCs não muda):
--   a) trava transacional (advisory lock) nas RPCs que mexem em acesso: sem
--      ela, dois admins se desativando ao mesmo tempo zeravam os admins;
--   b) bcrypt com custo 10 (a origem usava o padrão do pgcrypto, custo 6);
--   c) verify_login gasta o bcrypt mesmo sem usuário, para o tempo de resposta
--      não revelar se o email existe;
--   d) argumento nulo vira INVALID_INPUT em vez de estourar NOT NULL (500).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. pgcrypto: a fundação já cria. Repetido aqui porque todo o login depende
-- dele, e a asserção falha na migration, não no primeiro login, se a extensão
-- estiver noutro schema (as funções chamam `extensions.crypt` qualificado).
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if pg_catalog.to_regprocedure('extensions.crypt(text, text)') is null
     or pg_catalog.to_regprocedure('extensions.gen_salt(text, integer)') is null then
    raise exception 'USUARIOS: pgcrypto não está no schema extensions (crypt/gen_salt ausentes)';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 1. Tabela.
-- ----------------------------------------------------------------------------
create table if not exists public.app_users (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,
  name                 text not null,
  password_hash        text not null,
  is_active            boolean not null default true,
  -- Só `admin` e `member`: `paid_traffic` saiu com o Rastreamento Meta.
  role                 text not null default 'member',
  avatar_url           text,
  avatar_color         text not null default 'slate',
  -- Lido fresco a cada navegação (não vai no JWT): forçar troca vale na hora
  -- (origem: 20260714120000).
  must_change_password boolean not null default false,
  -- Assinatura das mensagens do chat: o apelido, ou o 1º nome se vazio
  -- (origem: 20260714180000).
  apelido_atendimento  text,
  assinar_mensagens    boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.app_users is
  'Usuários do dashboard (login por email e senha). Escrita só pelas RPCs de gestão.';
comment on column public.app_users.password_hash is
  'Hash bcrypt. Nunca sai do banco: nem o service_role tem SELECT nesta coluna.';
comment on column public.app_users.must_change_password is
  'Obriga a definir a própria senha antes de usar o app. Limpo quando o próprio usuário troca a senha.';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.app_users'::regclass
       and conname = 'app_users_role_check'
  ) then
    alter table public.app_users
      add constraint app_users_role_check check (role in ('admin', 'member'));
  end if;
end
$$;

-- Email único sem diferença de caixa (origem: 20260703000000). O seed conta com
-- este índice no `on conflict do nothing`.
create unique index if not exists app_users_email_lower_idx
  on public.app_users (lower(email));

-- ----------------------------------------------------------------------------
-- 2. RPCs. Todas SECURITY DEFINER com search_path vazio: é o que deixa a
-- função ler `password_hash` e escrever na tabela, que o service_role não lê
-- nem escreve direto. Nome de tabela e de função da extensão vai qualificado.
--
-- Mensagens de erro são TAGS que `map-user-rpc-error.ts` casa por substring:
-- não traduza nem renomeie.
-- ----------------------------------------------------------------------------

-- Aridades antigas da origem. Num banco novo elas não existem. Se existirem,
-- a versão com menos argumentos deixa a chamada ambígua ("function is not
-- unique") e derruba desativar usuário, salvar perfil e avatar, o incidente
-- descrito em 20260714180000.
drop function if exists public.create_app_user(text, text, text);
drop function if exists public.create_app_user(text, text, text, text, text);
drop function if exists public.create_app_user(text, text, text, text, text, boolean);
drop function if exists public.update_app_user(uuid, uuid, text, text, boolean);
drop function if exists public.update_app_user(uuid, uuid, text, text, boolean, text, text, text);
drop function if exists public.reset_app_user_password(uuid, text);
drop function if exists public.reset_app_user_password(uuid, uuid, text);

-- 2.1 Login. Devolve o usuário se a senha confere e ele está ativo; senão,
-- nenhuma linha. O hash nunca é devolvido.
create or replace function public.verify_login(p_email text, p_password text)
returns table (
  id uuid,
  email text,
  name text,
  role text,
  avatar_url text,
  avatar_color text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users%rowtype;
  v_hash text;
  v_ok boolean;
begin
  select au.* into v_user
    from public.app_users au
   where pg_catalog.lower(au.email) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));

  -- Sem usuário, o bcrypt roda sobre um salt descartável com o mesmo custo: o
  -- tempo de resposta fica igual ao de senha errada. A origem só gastava o
  -- bcrypt quando achava o email, e isso revelava quem tem conta.
  v_hash := coalesce(v_user.password_hash, extensions.gen_salt('bf', 10));
  v_ok := v_hash = extensions.crypt(coalesce(p_password, ''), v_hash);

  if v_user.id is null or not v_user.is_active or not coalesce(v_ok, false) then
    return;
  end if;

  return query
  select v_user.id, v_user.email, v_user.name, v_user.role,
         v_user.avatar_url, v_user.avatar_color;
end;
$$;

comment on function public.verify_login(text, text) is
  'Confere email e senha (bcrypt) de usuário ativo. Nenhuma linha = credencial inválida.';

-- 2.2 Criar usuário. Sem p_actor_id na origem: a rota exige admin antes de
-- chamar. Os parâmetros novos têm DEFAULT para a chamada com menos argumentos
-- continuar resolvendo para esta função (origem: 20260714180000).
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
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_role text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_role, '')));
  v_color text := coalesce(nullif(pg_catalog.btrim(p_avatar_color), ''), 'slate');
  v_apelido text := nullif(pg_catalog.btrim(coalesce(p_apelido_atendimento, '')), '');
begin
  if v_email = '' or v_name = '' then
    raise exception 'INVALID_INPUT' using detail = 'Email e nome são obrigatórios.';
  end if;
  if v_role not in ('admin', 'member') then
    raise exception 'INVALID_ROLE' using detail = 'Papel inválido.';
  end if;
  if p_password is null or pg_catalog.length(p_password) < 8 then
    raise exception 'WEAK_PASSWORD' using detail = 'A senha deve ter ao menos 8 caracteres.';
  end if;

  return query
  insert into public.app_users as au (
    email, name, password_hash, role, avatar_color,
    must_change_password, apelido_atendimento, assinar_mensagens
  )
  values (
    v_email,
    v_name,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    v_role,
    v_color,
    coalesce(p_must_change_password, false),
    v_apelido,
    coalesce(p_assinar_mensagens, true)
  )
  returning au.id, au.email, au.name, au.role, au.avatar_url, au.avatar_color,
            au.is_active, au.created_at;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

comment on function public.create_app_user(text, text, text, text, text, boolean, text, boolean) is
  'Cria usuário com senha bcrypt. A rota confere se quem chama é admin.';

-- 2.3 Atualizar perfil, papel e acesso.
--   - Membro edita só a si mesmo, e nunca o próprio papel ou acesso.
--   - Ninguém se desativa nem troca o próprio papel (SELF_ROLE_CHANGE).
--   - O último admin ativo não é desativado nem rebaixado.
--   - p_avatar_url nulo ou vazio LIMPA a foto (a rota do avatar usa isso).
--   - p_apelido_atendimento e p_assinar_mensagens nulos = "não altera": o
--     toggle de ativar e a rota do avatar chamam com 8 argumentos, e não podem
--     apagar o apelido de ninguém (origem: 20260714180000).
-- Aliases em toda coluna: as colunas do RETURNS TABLE viram variáveis e
-- colidem com as da tabela (origem: 20260713153000).
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
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_role text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_role, '')));
  v_color text := coalesce(nullif(pg_catalog.btrim(p_avatar_color), ''), 'slate');
  v_other_admins integer;
begin
  -- Serializa as RPCs que mexem em acesso. Sem isto, com dois admins, A
  -- desativando B e B desativando A ao mesmo tempo contam "1 outro admin" cada
  -- um e zeram os admins. Depois da trava, as leituras abaixo já enxergam o
  -- que a transação anterior gravou (read committed, snapshot por comando).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.app_users:gestao', 0)
  );

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
  if v_email = '' or v_name = '' or p_is_active is null then
    raise exception 'INVALID_INPUT' using detail = 'Email, nome e acesso são obrigatórios.';
  end if;
  if v_role not in ('admin', 'member') then
    raise exception 'INVALID_ROLE' using detail = 'Papel inválido.';
  end if;
  if v_actor.role <> 'admin'
     and (v_role <> v_target.role or p_is_active <> v_target.is_active) then
    raise exception 'FORBIDDEN' using detail = 'Você não pode alterar papel ou acesso.';
  end if;
  if p_actor_id = p_id and (p_is_active = false or v_role <> v_target.role) then
    raise exception 'SELF_ROLE_CHANGE' using detail = 'Você não pode remover o próprio acesso ou papel.';
  end if;

  if v_target.role = 'admin' and v_target.is_active
     and (p_is_active = false or v_role <> 'admin') then
    select pg_catalog.count(*) into v_other_admins
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
         avatar_url = nullif(pg_catalog.btrim(p_avatar_url), ''),
         avatar_color = v_color,
         apelido_atendimento = case
           when p_apelido_atendimento is null then u.apelido_atendimento
           else nullif(pg_catalog.btrim(p_apelido_atendimento), '')
         end,
         assinar_mensagens = coalesce(p_assinar_mensagens, u.assinar_mensagens),
         updated_at = pg_catalog.now()
   where u.id = p_id
  returning u.id, u.email, u.name, u.role, u.avatar_url, u.avatar_color,
            u.is_active, u.created_at;
exception
  when unique_violation then
    raise exception 'EMAIL_TAKEN' using detail = 'Já existe um usuário com este email.';
end;
$$;

comment on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text, text, boolean) is
  'Atualiza perfil, papel e acesso com as travas de autoalteração e de último admin ativo.';

-- 2.4 Redefinir senha.
--   p_must_change_password: null = mantém o flag; true = força troca no
--   próximo acesso (senha temporária); false = limpa.
--   Quando a pessoa troca a PRÓPRIA senha, o flag sempre é limpo: ela acabou de
--   escolher a senha (origem: 20260714120000 e 20260714150000). `definir-senha`
--   chama com 3 argumentos e depende do DEFAULT.
create or replace function public.reset_app_user_password(
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
  -- Mesma trava de update_app_user: quem acabou de ser desativado ou
  -- rebaixado não redefine a senha de outro na mesma janela.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.app_users:gestao', 0)
  );

  select au.* into v_actor
    from public.app_users au
   where au.id = p_actor_id and au.is_active;

  if v_actor.id is null then
    raise exception 'UNAUTHORIZED' using detail = 'Sessão sem acesso.';
  end if;
  if v_actor.role <> 'admin' and p_actor_id <> p_id then
    raise exception 'FORBIDDEN' using detail = 'Você só pode alterar a própria senha.';
  end if;
  if p_password is null or pg_catalog.length(p_password) < 8 then
    raise exception 'WEAK_PASSWORD' using detail = 'A senha deve ter ao menos 8 caracteres.';
  end if;

  update public.app_users au
     set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         must_change_password = case
           when p_actor_id = p_id then false
           else coalesce(p_must_change_password, au.must_change_password)
         end,
         updated_at = pg_catalog.now()
   where au.id = p_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using detail = 'Usuário não encontrado.';
  end if;
end;
$$;

comment on function public.reset_app_user_password(uuid, uuid, text, boolean) is
  'Troca a senha (bcrypt). Admin troca a de qualquer um; membro, só a própria.';

-- 2.5 Excluir usuário (hard delete). Só admin; nunca a si mesmo; nunca o
-- último admin ativo (origem: 20260714150000).
create or replace function public.delete_app_user(p_actor_id uuid, p_id uuid)
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.app_users:gestao', 0)
  );

  select au.* into v_actor
    from public.app_users au
   where au.id = p_actor_id and au.is_active;
  if v_actor.id is null then
    raise exception 'UNAUTHORIZED' using detail = 'Sessão sem acesso.';
  end if;
  if v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using detail = 'Apenas administradores podem excluir usuários.';
  end if;

  select au.* into v_target
    from public.app_users au
   where au.id = p_id;
  if v_target.id is null then
    raise exception 'USER_NOT_FOUND' using detail = 'Usuário não encontrado.';
  end if;

  if p_actor_id = p_id then
    raise exception 'SELF_DELETE' using detail = 'Você não pode excluir a própria conta.';
  end if;

  if v_target.role = 'admin' and v_target.is_active then
    select pg_catalog.count(*) into v_other_admins
      from public.app_users au
     where au.id <> p_id and au.role = 'admin' and au.is_active;
    if v_other_admins = 0 then
      raise exception 'LAST_ACTIVE_ADMIN' using detail = 'Deve haver ao menos um administrador ativo.';
    end if;
  end if;

  -- Na origem estas duas colunas não tinham FK, e a função as zerava na mão
  -- para não deixar id órfão. Se o baseline der FK `on delete set null` a elas,
  -- a limpeza fica redundante e inofensiva; se der `restrict`, é ela que deixa
  -- o delete passar. O teste de existência deixa a função utilizável antes de
  -- as migrations de integração e de chat rodarem.
  if pg_catalog.to_regclass('public.api_tokens') is not null then
    update public.api_tokens set created_by = null where created_by = p_id;
  end if;
  if pg_catalog.to_regclass('public.chat_messages') is not null then
    update public.chat_messages set sent_by_user_id = null where sent_by_user_id = p_id;
  end if;

  delete from public.app_users au where au.id = p_id;
end;
$$;

comment on function public.delete_app_user(uuid, uuid) is
  'Exclui usuário. Só admin, nunca a si mesmo, nunca o último admin ativo.';

-- ----------------------------------------------------------------------------
-- 3. Permissões.
--
-- Tabela: RLS ligada e SEM policy fecha anon e authenticated; o service_role
-- ignora RLS, então o que o limita é o grant. Ele recebe só SELECT e só nas
-- colunas que o app lê: o default privilege do `postgres` dá ALL ao
-- service_role em tabela nova, e sem este revoke o hash ficaria legível pela
-- service key. Escrita só pelas RPCs. O TS nunca faz `select("*")` em
-- app_users (get-app-users.ts e users/[id]/avatar listam as colunas).
--
-- Não use FORCE ROW LEVEL SECURITY: as RPCs rodam como o dono da tabela e
-- deixariam de enxergar as linhas.
-- ----------------------------------------------------------------------------
alter table public.app_users enable row level security;

-- `revoke all` na tabela também tira os grants por coluna: re-executar volta
-- ao mesmo estado.
revoke all on table public.app_users from public, anon, authenticated, service_role;
grant select (
  id, email, name, is_active, role, avatar_url, avatar_color,
  must_change_password, apelido_atendimento, assinar_mensagens,
  created_at, updated_at
) on public.app_users to service_role;

-- Funções: o EXECUTE nasce para PUBLIC e anon herda dali. Revogar só de anon
-- não fecha nada (origem: 20260819120000, bloco 4, erro a).
revoke all on function public.verify_login(text, text)
  from public, anon, authenticated;
revoke all on function public.create_app_user(text, text, text, text, text, boolean, text, boolean)
  from public, anon, authenticated;
revoke all on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.reset_app_user_password(uuid, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.delete_app_user(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.verify_login(text, text) to service_role;
grant execute on function public.create_app_user(text, text, text, text, text, boolean, text, boolean) to service_role;
grant execute on function public.update_app_user(uuid, uuid, text, text, boolean, text, text, text, text, boolean) to service_role;
grant execute on function public.reset_app_user_password(uuid, uuid, text, boolean) to service_role;
grant execute on function public.delete_app_user(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Asserções locais: o que o baseline geral não confere.
-- ----------------------------------------------------------------------------
do $$
begin
  if pg_catalog.has_column_privilege('service_role', 'public.app_users', 'password_hash', 'SELECT') then
    raise exception 'USUARIOS: service_role consegue ler app_users.password_hash';
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.app_users', 'INSERT, UPDATE, DELETE, TRUNCATE') then
    raise exception 'USUARIOS: service_role escreve em app_users direto; a escrita é só pelas RPCs';
  end if;
  if not pg_catalog.has_column_privilege('service_role', 'public.app_users', 'must_change_password', 'SELECT') then
    raise exception 'USUARIOS: service_role perdeu a leitura do perfil; getAppUser quebraria';
  end if;
  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.update_app_user(uuid, uuid, text, text, boolean, text, text, text, text, boolean)',
       'EXECUTE') then
    raise exception 'USUARIOS: service_role não executa update_app_user';
  end if;
  -- Sobrecarga esquecida deixa a chamada com menos argumentos ambígua.
  if (select pg_catalog.count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('verify_login', 'create_app_user', 'update_app_user',
                           'reset_app_user_password', 'delete_app_user')) <> 5 then
    raise exception 'USUARIOS: há sobrecarga das RPCs de usuário; a chamada ficaria ambígua';
  end if;
end
$$;

select public.assert_security_baseline();
