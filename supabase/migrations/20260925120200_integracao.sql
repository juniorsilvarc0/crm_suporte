-- ============================================================================
-- Baseline · 3/6 — integração e configuração do app.
--
--   app_settings               configuração global chave → jsonb (relay, assinatura do bot)
--   app_environment_variables  cofre: só metadados; o valor fica cifrado no Vault
--   api_tokens                 credenciais da API v1 (só o hash sha256 é gravado)
--   integration_logs           trilha append-only das chamadas de integração
--   user_notes                 "Minhas notas" da tela de Início
--
-- Portado de (legado em supabase/legado-clinica/):
--   20260707010000_funnel_stage_meta.sql         app_settings
--   20260811140000_variaveis_ambiente_seguras.sql cofre + RPCs do Vault
--   20260706170000_api_tokens.sql                api_tokens
--   20260101000000_core_schema.sql               integration_logs
--   20260818000000_notas_do_usuario.sql          user_notes
--   20260819120000_blindagem_anon.sql            RLS sem policy, revoke de PUBLIC
--
-- Segurança (AGENTS §3.1): toda tabela nasce com RLS ligada e SEM policy; nada
-- para PUBLIC/anon/authenticated; o service_role recebe só os verbos que o app
-- usa. Nenhuma tabela daqui entra no Realtime.
--
-- Depende de: 20260925120000_fundacao (set_updated_at, assert_security_baseline,
-- supabase_vault) e 20260925120100_usuarios (app_users).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Pré-requisitos. Falhar aqui, com o nome do que falta, é melhor que um
--    "relation does not exist" no meio do arquivo.
-- ----------------------------------------------------------------------------

-- Mesma linha da origem (20260811140000). No-op quando a fundação já criou.
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if to_regclass('public.app_users') is null then
    raise exception 'integracao: public.app_users não existe; aplique 20260925120100_usuarios antes';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'integracao: public.set_updated_at() não existe; aplique 20260925120000_fundacao antes';
  end if;
  if to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'integracao: public.assert_security_baseline() não existe; aplique 20260925120000_fundacao antes';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'integracao: vault.decrypted_secrets não existe; a extensão supabase_vault não subiu';
  end if;
end
$$;

-- ============================================================================
-- 1. app_settings — porte de 20260707010000_funnel_stage_meta.sql
-- ============================================================================

-- Chaves em uso: 'automation' {relay_url} e 'bot_signature' {enabled, apelido}.
-- `key` é PK (unique NÃO parcial) porque as rotas fazem upsert com
-- onConflict: 'key'; índice parcial não serve de alvo para o ON CONFLICT.
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is
  'Configuração global do CRM (chave → objeto jsonb). Acesso só pelo servidor (service_role).';

do $$
declare
  c record;
begin
  for c in
    select * from (values
      -- Chave em snake_case: evita lixo de digitação virar configuração órfã.
      ('app_settings_key_format_check',
       $c$check (key ~ '^[a-z][a-z0-9_]{0,63}$')$c$),
      -- O TS lê `value` como objeto ({relay_url}, {enabled, apelido}).
      ('app_settings_value_object_check',
       $c$check (jsonb_typeof(value) = 'object')$c$)
    ) as t(conname, definition)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.app_settings'::regclass and conname = c.conname
    ) then
      execute format('alter table public.app_settings add constraint %I %s', c.conname, c.definition);
    end if;
  end loop;
end
$$;

-- O upsert manda updated_at, mas o carimbo não pode depender disso.
drop trigger if exists trg_app_settings_set_updated_at on public.app_settings;
create trigger trg_app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

-- Upsert = INSERT + ON CONFLICT DO UPDATE. O PostgREST põe TODAS as colunas do
-- corpo no SET (inclusive `key`), então UPDATE por coluna quebraria o upsert.
-- Sem DELETE: nenhuma rota apaga configuração.
revoke all on table public.app_settings from public, anon, authenticated, service_role;
grant select, insert, update on table public.app_settings to service_role;

-- ============================================================================
-- 2. Cofre — porte de 20260811140000_variaveis_ambiente_seguras.sql
--
-- O valor NUNCA fica em tabela de public: `app_environment_variables` guarda só
-- metadados e o `secret_id`; o segredo cifrado mora no Supabase Vault. As RPCs
-- abaixo são a única fronteira de leitura e escrita do valor, e só o
-- service_role as executa.
-- ============================================================================

create table if not exists public.app_environment_variables (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  secret_id  uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_environment_variables is
  'Metadados das variáveis de runtime administradas no CRM; os valores ficam cifrados no Supabase Vault.';

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('app_environment_variables_name_key', 'unique (name)'),
      ('app_environment_variables_secret_id_key', 'unique (secret_id)'),
      -- Mesmo padrão de ENVIRONMENT_VARIABLE_NAME_PATTERN em settings/types.ts.
      ('app_environment_variables_name_format_check',
       $c$check (name ~ '^[A-Z][A-Z0-9_]{0,63}$')$c$)
    ) as t(conname, definition)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.app_environment_variables'::regclass and conname = c.conname
    ) then
      execute format('alter table public.app_environment_variables add constraint %I %s', c.conname, c.definition);
    end if;
  end loop;
end
$$;

alter table public.app_environment_variables enable row level security;

-- Escrita só por RPC. Leitura só das colunas que a tela lista
-- (get-environment-variables.ts): o servidor não precisa do `secret_id`.
-- ⚠️ Por isso `select('*')` nesta tabela responde "permission denied".
revoke all on table public.app_environment_variables from public, anon, authenticated, service_role;
grant select (id, name, created_at, updated_at)
  on table public.app_environment_variables to service_role;

-- Grava ou substitui. Sem p_replace, nome existente responde 23505, que a rota
-- traduz em 409 "Esta variável já existe".
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

  -- Duas gravações do mesmo nome ao mesmo tempo criariam dois segredos no
  -- Vault para uma linha só. O lock por nome serializa.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_environment_variable:' || v_name, 0)
  );

  select variable.secret_id
    into v_secret_id
  from public.app_environment_variables as variable
  where variable.name = v_name
  for update;

  if v_secret_id is not null and not coalesce(p_replace, false) then
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

-- Uma variável. Nome inexistente devolve null.
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

-- Novo (Fase 2): leitura em lote para o catálogo de get-runtime-environment,
-- que carrega os segredos de uma vez para o cache de 60 s em vez de uma ida
-- ao banco por nome. Devolve só os nomes que existem, já normalizados
-- (maiúsculas); nome ausente simplesmente não aparece. O teto de 64 nomes
-- evita que um bug no chamador vire varredura do cofre inteiro.
create or replace function public.get_app_environment_variables(p_names text[])
returns table (name text, value text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.cardinality(p_names), 0) > 64 then
    raise exception 'too_many_environment_variables'
      using errcode = '22023';
  end if;

  return query
    select variable.name, decrypted.decrypted_secret
    from public.app_environment_variables as variable
    join vault.decrypted_secrets as decrypted
      on decrypted.id = variable.secret_id
    where variable.name in (
      select upper(btrim(requested.item))
      from pg_catalog.unnest(p_names) as requested(item)
      where requested.item is not null
    )
    order by variable.name;
end;
$$;

-- Apaga metadado e segredo juntos. false = não existia (a rota responde 404).
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

-- Função nasce com EXECUTE para PUBLIC, e anon herda dali: revogar só de anon
-- não fecha nada (20260819120000_blindagem_anon.sql, bloco 4, erro (a)).
revoke execute on function public.set_app_environment_variable(text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.get_app_environment_variable(text)
  from public, anon, authenticated;
revoke execute on function public.get_app_environment_variables(text[])
  from public, anon, authenticated;
revoke execute on function public.delete_app_environment_variable(text)
  from public, anon, authenticated;

grant execute on function public.set_app_environment_variable(text, text, boolean)
  to service_role;
grant execute on function public.get_app_environment_variable(text)
  to service_role;
grant execute on function public.get_app_environment_variables(text[])
  to service_role;
grant execute on function public.delete_app_environment_variable(text)
  to service_role;

-- ============================================================================
-- 3. api_tokens — porte de 20260706170000_api_tokens.sql
--
-- O token em texto puro aparece UMA vez, na criação; só o sha256 (hex) fica
-- gravado, então vazar o banco não entrega token válido. Revogar é marcar
-- `revoked_at`, nunca apagar: a linha guarda o histórico e o hash não volta
-- a valer.
--
-- Novo na Fase 2 (plano §C): escopos, validade e limite por token, para o
-- `withApi` da API v1.
-- ============================================================================

create table if not exists public.api_tokens (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  token_hash         text not null,
  token_prefix       text not null,
  -- Vazio = o token não alcança nada. Token criado sem escopo nasce inerte.
  scopes             text[] not null default '{}',
  -- Nulo = sem validade.
  expires_at         timestamptz,
  -- Sempre há limite: um nulo esquecido pelo app viraria "sem limite".
  rate_limit_per_min integer not null default 120,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz
);

comment on table public.api_tokens is
  'Tokens da API do CRM para integradores (IA de triagem, n8n). Guarda só o hash sha256 do token.';
comment on column public.api_tokens.scopes is
  'Escopos no formato recurso:acao (ex.: tickets:read). Vazio = nenhum acesso.';

do $$
declare
  c record;
begin
  for c in
    select * from (values
      -- O lookup do withApi é por hash; unique também impede reuso de hash.
      ('api_tokens_token_hash_key', 'unique (token_hash)'),
      -- sha256 em hex minúsculo (lib/security/api-token.ts). Barra gravar o
      -- token em texto puro por engano.
      ('api_tokens_token_hash_format_check',
       $c$check (token_hash ~ '^[0-9a-f]{64}$')$c$),
      -- O prefixo é só para reconhecer o token na lista; hoje são 12 caracteres.
      ('api_tokens_token_prefix_length_check',
       'check (char_length(token_prefix) between 4 and 16)'),
      -- createApiTokenSchema: 1 a 60 caracteres, com trim.
      ('api_tokens_name_length_check',
       'check (char_length(btrim(name)) between 1 and 60)'),
      ('api_tokens_scopes_shape_check',
       $c$check (
         coalesce(array_ndims(scopes), 1) = 1
         and cardinality(scopes) <= 64
         and array_position(scopes, null) is null
         and (
           cardinality(scopes) = 0
           or array_to_string(scopes, ',')
              ~ '^[a-z][a-z_]*:([a-z][a-z_]*|\*)(,[a-z][a-z_]*:([a-z][a-z_]*|\*))*$'
         )
       )$c$),
      ('api_tokens_rate_limit_check',
       'check (rate_limit_per_min between 1 and 6000)'),
      -- 20260714150000_gestao_usuarios_avancada.sql limpava created_by à mão
      -- (referência sem FK). Aqui o banco garante.
      ('api_tokens_created_by_fkey',
       'foreign key (created_by) references public.app_users (id) on delete set null')
    ) as t(conname, definition)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.api_tokens'::regclass and conname = c.conname
    ) then
      execute format('alter table public.api_tokens add constraint %I %s', c.conname, c.definition);
    end if;
  end loop;
end
$$;

-- Lookup entre os tokens ativos (origem: idx_api_tokens_active).
create index if not exists idx_api_tokens_active
  on public.api_tokens (token_hash)
  where revoked_at is null;

-- FK sem índice vira varredura a cada exclusão de usuário.
create index if not exists idx_api_tokens_created_by
  on public.api_tokens (created_by)
  where created_by is not null;

-- Revogação é definitiva. Desfazer `revoked_at` ressuscitaria um token que
-- pode ter vazado; a rota de revogar já filtra `revoked_at is null`.
create or replace function public.api_tokens_guard_revocation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'api_token_revocation_is_final'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_api_tokens_guard_revocation on public.api_tokens;
create trigger trg_api_tokens_guard_revocation
  before update of revoked_at on public.api_tokens
  for each row execute function public.api_tokens_guard_revocation();

revoke execute on function public.api_tokens_guard_revocation()
  from public, anon, authenticated;
grant execute on function public.api_tokens_guard_revocation()
  to service_role;

alter table public.api_tokens enable row level security;

-- SELECT inteiro: o withApi filtra por token_hash, e filtrar exige SELECT na
-- coluna. UPDATE só no que é editável: hash, prefixo, autor e criação são
-- imutáveis (trocar o hash é emitir outro token). Sem DELETE: revogar não apaga.
revoke all on table public.api_tokens from public, anon, authenticated, service_role;
grant select, insert on table public.api_tokens to service_role;
grant update (name, scopes, expires_at, rate_limit_per_min, last_used_at, revoked_at)
  on table public.api_tokens to service_role;

-- ============================================================================
-- 4. integration_logs — porte de 20260101000000_core_schema.sql
--
-- Append-only: o service_role só lê e insere. As colunas novas (plano §C)
-- ligam cada chamada da API v1 ao token e ao request_id devolvido no erro.
-- O corpo da requisição não é gravado (regra do withApi, no TS).
-- ============================================================================

create table if not exists public.integration_logs (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  direction    text,
  action       text,
  status       text,
  payload      jsonb,
  error        text,
  api_token_id uuid,
  request_id   text,
  route        text,
  http_status  smallint,
  latency_ms   integer,
  created_at   timestamptz not null default now()
);

comment on table public.integration_logs is
  'Trilha append-only das chamadas de integração (API v1, webhooks, relay). Sem corpo de requisição.';

do $$
declare
  c record;
begin
  for c in
    select * from (values
      -- Checks da origem: os dois aceitam nulo.
      ('integration_logs_direction_check',
       $c$check (direction is null or direction in ('inbound', 'outbound'))$c$),
      ('integration_logs_status_check',
       $c$check (status is null or status in ('ok', 'error'))$c$),
      ('integration_logs_http_status_check',
       'check (http_status is null or http_status between 100 and 599)'),
      ('integration_logs_latency_ms_check',
       'check (latency_ms is null or latency_ms >= 0)'),
      ('integration_logs_request_id_length_check',
       'check (request_id is null or char_length(request_id) <= 128)'),
      ('integration_logs_route_length_check',
       'check (route is null or char_length(route) <= 512)'),
      -- Token nunca é apagado (revogar é soft), mas se um dia for purgado o
      -- log fica, sem o vínculo.
      ('integration_logs_api_token_id_fkey',
       'foreign key (api_token_id) references public.api_tokens (id) on delete set null')
    ) as t(conname, definition)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.integration_logs'::regclass and conname = c.conname
    ) then
      execute format('alter table public.integration_logs add constraint %I %s', c.conname, c.definition);
    end if;
  end loop;
end
$$;

create index if not exists integration_logs_created_at_idx
  on public.integration_logs (created_at desc);

-- A aba Logs filtra por integração e ordena do mais recente.
create index if not exists integration_logs_provider_created_at_idx
  on public.integration_logs (provider, created_at desc);

-- Chamadas de um token (e índice da FK).
create index if not exists integration_logs_api_token_created_at_idx
  on public.integration_logs (api_token_id, created_at desc)
  where api_token_id is not null;

-- O integrador reporta o request_id do erro; o suporte acha a linha por ele.
create index if not exists integration_logs_request_id_idx
  on public.integration_logs (request_id)
  where request_id is not null;

alter table public.integration_logs enable row level security;

revoke all on table public.integration_logs from public, anon, authenticated, service_role;
grant select, insert on table public.integration_logs to service_role;

-- ============================================================================
-- 5. user_notes — porte de 20260818000000_notas_do_usuario.sql
--
-- Duas naturezas na mesma tabela, separadas por `kind`:
--   quick  → o lembrete rápido, UM por usuário (o índice único parcial garante)
--   sticky → os post-its, N por usuário
-- Dado do próprio usuário: cai junto com ele (cascade). Cada rota filtra pelo
-- user_id da SESSÃO; o banco não conhece a sessão.
-- ============================================================================

create table if not exists public.user_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  kind       text not null default 'sticky',
  title      text,
  content    text not null default '',
  color      text not null default 'amber',
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_notes is
  'Notas pessoais da tela de Início: um lembrete rápido (quick) e N post-its (sticky) por usuário.';

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('user_notes_kind_check',
       $c$check (kind in ('quick', 'sticky'))$c$),
      -- Tetos de home/schemas/note.ts (2000 e 80). O banco conta code points
      -- e o zod conta unidades UTF-16, então o banco nunca é mais rígido.
      ('user_notes_content_length_check',
       'check (char_length(content) <= 2000)'),
      ('user_notes_title_length_check',
       'check (title is null or char_length(title) <= 80)'),
      ('user_notes_user_id_fkey',
       'foreign key (user_id) references public.app_users (id) on delete cascade')
    ) as t(conname, definition)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.user_notes'::regclass and conname = c.conname
    ) then
      execute format('alter table public.user_notes add constraint %I %s', c.conname, c.definition);
    end if;
  end loop;
end
$$;

-- Um único lembrete rápido por usuário: o índice é a regra, não a aplicação.
create unique index if not exists user_notes_one_quick_per_user
  on public.user_notes (user_id)
  where kind = 'quick';

-- Serve a leitura de get-notes (user_id, ordem) e a FK.
create index if not exists idx_user_notes_user_kind
  on public.user_notes (user_id, kind, position, created_at desc);

-- `updated_at` é o "Atualizado em…" da UI, e as rotas não o enviam.
-- A origem tinha touch_user_notes_updated_at(), com o mesmo corpo de
-- set_updated_at(); aqui usa a da fundação.
drop trigger if exists trg_user_notes_set_updated_at on public.user_notes;
create trigger trg_user_notes_set_updated_at
  before update on public.user_notes
  for each row execute function public.set_updated_at();

alter table public.user_notes enable row level security;

-- A origem criava uma policy `for all to service_role`. Ela não faz nada
-- (service_role ignora RLS) e o baseline é "RLS ligada, sem policy".
drop policy if exists user_notes_service_role_all on public.user_notes;

-- UPDATE só no que as rotas editam: dono e natureza da nota são imutáveis,
-- então um bug no app não move a nota para outra pessoa.
revoke all on table public.user_notes from public, anon, authenticated, service_role;
grant select, insert, delete on table public.user_notes to service_role;
grant update (title, content, color, position)
  on table public.user_notes to service_role;

-- ----------------------------------------------------------------------------
-- A migration só termina se a blindagem continua de pé.
-- ----------------------------------------------------------------------------
select public.assert_security_baseline();
