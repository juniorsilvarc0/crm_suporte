-- Tokens de API para integradores externos (n8n, parceiros) chamarem os webhooks.
-- O token em texto puro é mostrado UMA única vez na criação; só o hash sha256
-- (hex) é persistido, então um vazamento do banco não expõe tokens válidos.
create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null,
  token_prefix text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint api_tokens_token_hash_key unique (token_hash)
);

comment on table public.api_tokens is
  'Tokens de API para autenticar chamadas externas aos webhooks (n8n/parceiros). Guarda apenas o hash sha256 do token.';

-- Lookup rápido por hash entre os tokens ativos (usado no verify do webhook).
create index if not exists idx_api_tokens_active
  on public.api_tokens (token_hash)
  where revoked_at is null;

-- Acesso somente via service_role (admin client). Habilita RLS sem policy:
-- anon/authenticated não enxergam a tabela; service_role ignora RLS.
alter table public.api_tokens enable row level security;
