-- ---------------------------------------------------------------------------
-- Registrar venda: catálogo de procedimentos + escrita atômica.
--
-- Contexto: `contracts` é a única entrada de dado financeiro do produto e a
-- fonte de receita/vendas/ticket/LTV do dashboard (get-dashboard-data.ts).
-- A rota antiga escrevia contrato, pagamentos, lead e deal em chamadas
-- separadas, sem transação: falha no meio deixava contrato órfão que o
-- dashboard já contava como receita cheia.
--
-- Esta migration é aditiva e idempotente. Traz:
--   1. `procedures` — catálogo mantido pelo usuário (como `tags` e
--      `board_columns`), com valor de referência opcional e arquivamento.
--   2. `contracts.idempotency_key` — retry e duplo-clique não duplicam venda.
--   3. `set_updated_at()` — `contracts.updated_at` nunca era atualizado.
--   4. `register_sale(...)` — grava contrato + pagamentos + funil numa
--      transação só.
--
-- Nada de conta de dinheiro aqui: os valores chegam já calculados em centavos
-- pelo TS (features/financeiro/lib/money.ts), que é onde os testes moram.
-- ---------------------------------------------------------------------------

-- 1. Catálogo de procedimentos ----------------------------------------------

create table if not exists public.procedures (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  default_amount numeric(12,2),
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint procedures_name_not_blank check (btrim(name) <> ''),
  constraint procedures_default_amount_positive
    check (default_amount is null or default_amount > 0)
);

-- Parcial: um nome arquivado não bloqueia recriar o mesmo procedimento depois.
create unique index if not exists procedures_name_lower_uidx
  on public.procedures (lower(btrim(name)))
  where archived_at is null;

create index if not exists procedures_archived_at_idx
  on public.procedures (archived_at);

-- Mesma postura de 20260706120000_rls_tabelas_core.sql: RLS ligada e sem
-- policy. Só a service role (server-side) enxerga.
alter table public.procedures enable row level security;
revoke all on public.procedures from anon, authenticated;

-- 2. Idempotência da venda ---------------------------------------------------

alter table public.contracts add column if not exists idempotency_key text;

-- Índice NÃO parcial, pelo mesmo motivo documentado em
-- 20260706140000_webhook_idempotency.sql: no Postgres vários NULL convivem num
-- índice único, e o ON CONFLICT precisa de um índice total para casar.
create unique index if not exists contracts_idempotency_key_uidx
  on public.contracts (idempotency_key);

-- O dashboard varre contratos por data de criação.
create index if not exists contracts_created_at_idx
  on public.contracts (created_at desc);

-- 3. updated_at ---------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_contracts_set_updated_at on public.contracts;
create trigger trg_contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_procedures_set_updated_at on public.procedures;
create trigger trg_procedures_set_updated_at
  before update on public.procedures
  for each row execute function public.set_updated_at();

-- 4. Venda atômica ------------------------------------------------------------
--
-- `p_payments` chega pronto do TS:
--   [{ "amount": 1800.00, "method": "pix", "is_signal": true,
--      "status": "pago", "due_at": null, "paid_at": "2026-08-07T12:00:00Z" }]
--
-- `contracts.signal_amount` NÃO é escrito de propósito. A entrada vira uma
-- linha em `payments` com `is_signal = true`, e `payments` passa a ser a única
-- fonte da verdade do dinheiro recebido — a coluna escalar duplicava o valor e
-- nada mantinha as duas em sincronia. Ela fica no schema por compatibilidade.
--
-- `p_stage_key` nulo = não mexer no funil. Se a coluna não existir em
-- `board_columns`, a venda é gravada assim mesmo e `moved` volta false: perder
-- a venda por causa de configuração do board seria pior que não mover o card.
--
-- Atenção: o update em `deals.stage` dispara `trg_deals_stage_history` — o
-- mesmo efeito do arraste no funil, incluindo a possível entrada em
-- `meta_conversion_outbox`. É desejado.

create or replace function public.register_sale(
  p_idempotency_key  text,
  p_lead_id          uuid,
  p_deal_id          uuid,
  p_procedure_name   text,
  p_total_amount     numeric,
  p_discount         numeric,
  p_notes            text,
  p_payments         jsonb,
  p_stage_key        text,
  p_stamp_cliente_at boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract_id uuid;
  v_status      text;
  v_moved       boolean := false;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required';
  end if;

  -- Reentrada: mesma chave devolve a venda que já existe, sem tocar em
  -- pagamento nem no funil.
  select c.id, c.status
    into v_contract_id, v_status
  from public.contracts c
  where c.idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'contractId', v_contract_id,
      'status', v_status,
      'moved', false,
      'alreadyRegistered', true
    );
  end if;

  insert into public.contracts (
    lead_id, package_name, total_amount, discount, status, notes, idempotency_key
  ) values (
    p_lead_id,
    nullif(btrim(p_procedure_name), ''),
    p_total_amount,
    coalesce(p_discount, 0),
    'aberto',
    nullif(btrim(p_notes), ''),
    p_idempotency_key
  )
  returning id, status into v_contract_id, v_status;

  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    insert into public.payments (
      lead_id, contract_id, amount, method, installments,
      is_signal, status, due_at, paid_at
    )
    select
      p_lead_id,
      v_contract_id,
      (item ->> 'amount')::numeric,
      nullif(item ->> 'method', ''),
      coalesce((item ->> 'installments')::integer, 1),
      coalesce((item ->> 'is_signal')::boolean, false),
      coalesce(item ->> 'status', 'pendente'),
      (item ->> 'due_at')::timestamptz,
      (item ->> 'paid_at')::timestamptz
    from jsonb_array_elements(p_payments) as item;
  end if;

  -- Funil: só move para uma coluna que existe de verdade.
  if p_stage_key is not null and p_deal_id is not null then
    if exists (select 1 from public.board_columns bc where bc.key = p_stage_key) then
      update public.deals
      set stage = p_stage_key,
          won_at = now(),
          lost_at = null
      where id = p_deal_id;

      v_moved := found;
    end if;
  end if;

  -- O lead acompanha a etapa do card. `cliente_at` só é carimbado quando a
  -- etapa de ganho é a canônica `cliente` — mesma regra de
  -- /api/leads/[id]/status, hoje isolada em leads/lib/status-timestamp.ts.
  if v_moved and p_lead_id is not null then
    update public.leads
    set status = p_stage_key,
        cliente_at = case
          when coalesce(p_stamp_cliente_at, false) then now()
          else cliente_at
        end
    where id = p_lead_id;
  end if;

  return jsonb_build_object(
    'contractId', v_contract_id,
    'status', v_status,
    'moved', v_moved,
    'alreadyRegistered', false
  );
end;
$$;

-- 5. Edição da venda ----------------------------------------------------------
--
-- Os pagamentos DERIVAM dos valores da venda: mudar total ou desconto muda a
-- linha. Por isso a edição substitui o conjunto inteiro em vez de tentar casar
-- linha a linha — e precisa ser transacional pelo mesmo motivo do insert.
--
-- Hoje `payments` só nasce daqui, então reescrever não perde nada. Quando
-- existir baixa manual de parcela, esta função precisa preservar o que já foi
-- pago fora da venda.
--
-- Venda cancelada não é editável: é registro fechado.

create or replace function public.update_sale(
  p_contract_id    uuid,
  p_procedure_name text,
  p_total_amount   numeric,
  p_discount       numeric,
  p_notes          text,
  p_payments       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead_id uuid;
  v_status  text;
begin
  select c.lead_id, c.status
    into v_lead_id, v_status
  from public.contracts c
  where c.id = p_contract_id
  for update;

  if not found then
    raise exception 'contract_not_found';
  end if;

  if v_status = 'cancelado' then
    raise exception 'contract_cancelled';
  end if;

  update public.contracts
  set package_name = nullif(btrim(p_procedure_name), ''),
      total_amount = p_total_amount,
      discount     = coalesce(p_discount, 0),
      notes        = nullif(btrim(p_notes), '')
  where id = p_contract_id;

  delete from public.payments where contract_id = p_contract_id;

  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    insert into public.payments (
      lead_id, contract_id, amount, method, installments,
      is_signal, status, due_at, paid_at
    )
    select
      v_lead_id,
      p_contract_id,
      (item ->> 'amount')::numeric,
      nullif(item ->> 'method', ''),
      coalesce((item ->> 'installments')::integer, 1),
      coalesce((item ->> 'is_signal')::boolean, false),
      coalesce(item ->> 'status', 'pendente'),
      (item ->> 'due_at')::timestamptz,
      (item ->> 'paid_at')::timestamptz
    from jsonb_array_elements(p_payments) as item;
  end if;

  return jsonb_build_object('contractId', p_contract_id, 'leadId', v_lead_id);
end;
$$;
