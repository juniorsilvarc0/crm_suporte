-- ============================================================================
-- Autenticação multiusuário do dashboard.
-- Substitui a credencial única estática por usuários com senha em hash (bcrypt).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null,
  password_hash text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.app_users is
  'Usuários que acessam o dashboard (login por email/senha). Senha em hash bcrypt.';

-- Email único case-insensitive (evita duplicar por diferença de caixa).
create unique index if not exists app_users_email_lower_idx
  on public.app_users (lower(email));

-- Só o service_role (rota de login) acessa esta tabela. RLS ligado sem policies
-- bloqueia anon/authenticated; o service_role ignora RLS por padrão.
alter table public.app_users enable row level security;
revoke all on public.app_users from anon, authenticated;

-- Valida o login sem expor o hash: retorna o usuário se a senha confere e está
-- ativo. SECURITY DEFINER + search_path vazio (padrão de segurança Supabase),
-- com todos os identificadores qualificados por schema.
create or replace function public.verify_login(p_email text, p_password text)
returns table (id uuid, email text, name text)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.email, u.name
  from public.app_users u
  where lower(u.email) = lower(trim(p_email))
    and u.is_active
    and u.password_hash = extensions.crypt(p_password, u.password_hash);
$$;

-- Executável apenas pelo service_role (a rota de login usa a service key).
revoke all on function public.verify_login(text, text) from public, anon, authenticated;
grant execute on function public.verify_login(text, text) to service_role;
