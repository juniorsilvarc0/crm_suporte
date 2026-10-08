-- ============================================================================
--   20261007170000_contratos_externos.sql
--
--   Espelho READ-ONLY dos contratos do cliente na fonte externa (TCBX). O nosso
--   `support_contracts` é o contrato comercial INTERNO da casa (valor, fila, um
--   vigente por empresa) e NÃO comporta o contrato de terceiro; este espelho
--   guarda o que a TCBX (fonte da verdade) devolve — sem valor e sem fila — só
--   para o CRM saber que o cliente tem contrato ativo e pode receber suporte.
--
--   Escrito SÓ pelo servidor (service_role, pela sincronização); nenhuma tela
--   cria ou edita. Dedup/upsert por (customer_id, provider, external_id) — o
--   mesmo contrato nunca duplica ao reconciliar. RLS ligada e NENHUMA policy:
--   anon/authenticated não alcançam; service_role (BYPASSRLS) lê e grava.
--   Termina com assert_security_baseline(), como toda migration (AGENTS §3.1).
-- ============================================================================

do $$
begin
  if to_regclass('public.customers') is null
     or to_regprocedure('public.assert_security_baseline()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'CONTRATOS_EXTERNOS: aplique as migrations de fundação/cadastros antes';
  end if;
end
$$;

-- ============================================================================
-- 1. Tabela
-- ============================================================================

create table if not exists public.external_contracts (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null,
  provider        text not null default 'tcbx',
  external_id     text not null,
  numero          text,
  modalidade      text,
  status          text,
  status_vigencia text,
  data_inicio     date,
  data_fim        date,
  vencimento_dia  smallint,
  data_ativacao   date,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint external_contracts_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint external_contracts_provider_check
    check (provider in ('tcbx')),
  constraint external_contracts_external_id_check
    check (btrim(external_id) <> '' and char_length(external_id) <= 120),
  constraint external_contracts_vencimento_dia_check
    check (vencimento_dia is null or vencimento_dia between 1 and 31),
  -- A identidade do contrato NA FONTE: a sincronização faz upsert por aqui, e o
  -- mesmo contrato nunca duplica ao reconciliar.
  constraint external_contracts_identity_uidx
    unique (customer_id, provider, external_id)
);

comment on table public.external_contracts is
  'Espelho read-only dos contratos do cliente na fonte externa (TCBX, fonte da verdade). Escrita só pela sincronização (service_role); nenhuma tela cria/edita. Sem valor nem fila — o contrato comercial interno é o support_contracts.';
comment on column public.external_contracts.external_id is
  'Id do contrato NA FONTE. Chave de upsert com (customer_id, provider).';
comment on column public.external_contracts.synced_at is
  'Quando este contrato foi lido da fonte pela última vez.';

-- ============================================================================
-- 2. Índices
-- ============================================================================

-- A ficha e o selo perguntam "esta empresa tem contrato ativo?". A TCBX devolve
-- `status_vigencia` em minúsculas ('ativo'); a sincronização grava como veio.
create index if not exists external_contracts_active_idx
  on public.external_contracts (customer_id)
  where status_vigencia = 'ativo';

-- ============================================================================
-- 3. RLS e privilégios de tabela (RLS ligada, NENHUMA policy)
-- ============================================================================

alter table public.external_contracts enable row level security;

revoke all on table public.external_contracts
  from public, anon, authenticated, service_role;

-- Espelho sem segredo: a sincronização (service_role) lê, grava, atualiza e
-- remove o que sumiu da fonte. Sem TRUNCATE/TRIGGER/REFERENCES (baseline 11).
grant select, insert, update, delete on table public.external_contracts to service_role;

-- ============================================================================
-- 4. Trigger de updated_at
-- ============================================================================

drop trigger if exists trg_external_contracts_set_updated_at on public.external_contracts;
create trigger trg_external_contracts_set_updated_at
  before update on public.external_contracts
  for each row execute function public.set_updated_at();

-- O PostgREST guarda o schema em cache; sem o reload ele segue com o mapa antigo.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
