-- ============================================================================
--   20261021140000_motivo_na_alteracao_do_ticket.sql  —  O motivo da alteração
--
--   A linha do tempo do ticket mostra cada alteração com o motivo numa linha:
--   o status já guardava (ticket_status_history.reason); a alteração de campo
--   (título, descrição, prioridade, fila, categoria, empresa) passa a guardar
--   também, em ticket.updated:  metadata = { changes, reason }.
--
--   - O motivo vem no próprio p_patch, na chave `reason`: não é coluna do
--     ticket, vai só para a trilha. Texto de até 500 caracteres depois de tirar
--     o espaço das pontas (o teto do motivo do status); vazio ou nulo = sem
--     motivo. Fora disso: INVALID_PATCH.
--   - MESMA assinatura de 20260925120900 (molde do create_ticket em
--     20260929170000): o corpo é o de lá, com o motivo como única mudança. Uma
--     2ª aridade deixaria a chamada ambígua, e a própria _tickets recusa
--     sobrecarga de RPC de ticket.
--   - Quem não manda `reason` grava como antes ({ changes }): a API v1 e a tela
--     atuais seguem iguais.
--
--   Aditiva e idempotente (create or replace). Depende de 20260925120900.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.ticket_update(uuid, integer, jsonb, uuid, uuid)') is null
     or to_regprocedure('public.ticket_record_event(uuid, text, text, uuid, uuid, jsonb, text)') is null
     or to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'MOTIVO_ALTERACAO: aplique 20260925120900_tickets antes';
  end if;
end
$$;

create or replace function public.ticket_update(
  p_ticket_id        uuid,
  p_expected_version integer,
  p_patch            jsonb,
  p_actor_user_id    uuid default null,
  p_actor_token_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   text;
  v_t       public.tickets%rowtype;
  v_new     public.tickets%rowtype;
  v_policy  public.sla_policies%rowtype;
  v_changes jsonb;
  v_reason  text;
begin
  v_actor := public.require_ticket_actor(p_actor_user_id, p_actor_token_id);

  if p_patch is null
     or pg_catalog.jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_patch) as k(key)
        where k.key not in ('title', 'description', 'priority', 'product_id', 'category_id', 'customer_id',
                             'reason')
     ) then
    raise exception 'INVALID_PATCH';
  end if;

  -- O motivo não é campo do ticket: vai só para a trilha (ticket.updated).
  if p_patch ? 'reason' then
    if pg_catalog.jsonb_typeof(p_patch -> 'reason') not in ('string', 'null') then
      raise exception 'INVALID_PATCH';
    end if;
    v_reason := nullif(pg_catalog.btrim(p_patch ->> 'reason'), '');
    if pg_catalog.char_length(v_reason) > 500 then
      raise exception 'INVALID_PATCH';
    end if;
  end if;

  select * into v_t from public.tickets t where t.id = p_ticket_id for no key update;
  if not found then
    raise exception 'TICKET_NOT_FOUND';
  end if;
  if v_t.closed_at is not null then
    raise exception 'TICKET_TERMINAL';
  end if;

  v_new := v_t;
  if p_patch ? 'title'       then v_new.title       := pg_catalog.btrim(p_patch ->> 'title'); end if;
  if p_patch ? 'description' then v_new.description := nullif(pg_catalog.btrim(p_patch ->> 'description'), ''); end if;
  if p_patch ? 'priority'    then v_new.priority    := p_patch ->> 'priority'; end if;
  if p_patch ? 'product_id'  then v_new.product_id  := (p_patch ->> 'product_id')::uuid; end if;
  if p_patch ? 'category_id' then v_new.category_id := (p_patch ->> 'category_id')::uuid; end if;
  if p_patch ? 'customer_id' then v_new.customer_id := (p_patch ->> 'customer_id')::uuid; end if;

  -- Mesmo valor = no-op ANTES da versão (retry seguro, molde set_support_contract_status).
  if (v_new.title, v_new.description, v_new.priority, v_new.product_id, v_new.category_id, v_new.customer_id)
     is not distinct from
     (v_t.title, v_t.description, v_t.priority, v_t.product_id, v_t.category_id, v_t.customer_id) then
    return pg_catalog.jsonb_build_object('ticket', public.ticket_summary(v_t.id), 'changed', false);
  end if;

  if p_expected_version is null or v_t.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using detail = v_t.version::text;
  end if;

  perform public.assert_ticket_refs(v_new.product_id, v_new.category_id, v_t.product_id, v_t.category_id);

  if v_new.customer_id is distinct from v_t.customer_id then
    if v_new.customer_id is not null then
      if not exists (select 1 from public.customers cu where cu.id = v_new.customer_id) then
        raise exception 'CUSTOMER_NOT_FOUND';
      end if;
      if exists (select 1 from public.customers cu
                  where cu.id = v_new.customer_id and cu.archived_at is not null) then
        raise exception 'CUSTOMER_ARCHIVED';
      end if;
    end if;
    v_new.contract_id := public.ticket_current_contract(v_new.customer_id);
  end if;

  -- Prioridade nova = snapshot novo. Solução = abertura + minutos + tudo que já
  -- ficou parado (a pausa em curso entra na retomada). 1ª resposta só se ainda
  -- não houve. *_breached_at não é tocado (é histórico da Fase 6).
  if v_new.priority is distinct from v_t.priority then
    select * into v_policy from public.sla_policies p where p.priority = v_new.priority;
    if not found then
      raise exception 'INVALID_PRIORITY';
    end if;
    v_new.sla_resolution_minutes := v_policy.resolution_minutes;
    v_new.sla_warn_pct := v_policy.warn_pct;
    v_new.resolution_due_at := v_t.created_at
      + pg_catalog.make_interval(secs => v_policy.resolution_minutes * 60 + v_t.sla_paused_seconds);
    if v_t.first_responded_at is null then
      v_new.sla_first_response_minutes := v_policy.first_response_minutes;
      v_new.first_response_due_at := v_t.created_at
        + pg_catalog.make_interval(mins => v_policy.first_response_minutes);
    end if;
  end if;

  update public.tickets t
     set title = v_new.title, description = v_new.description, priority = v_new.priority,
         product_id = v_new.product_id, category_id = v_new.category_id,
         customer_id = v_new.customer_id, contract_id = v_new.contract_id,
         sla_first_response_minutes = v_new.sla_first_response_minutes,
         sla_resolution_minutes = v_new.sla_resolution_minutes,
         sla_warn_pct = v_new.sla_warn_pct,
         first_response_due_at = v_new.first_response_due_at,
         resolution_due_at = v_new.resolution_due_at
   where t.id = v_t.id
  returning * into v_new;

  v_changes := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'title', case when v_new.title is distinct from v_t.title
      then pg_catalog.jsonb_build_object('from', v_t.title, 'to', v_new.title) end,
    'description', case when v_new.description is distinct from v_t.description
      then '{"changed":true}'::jsonb end,
    'priority', case when v_new.priority is distinct from v_t.priority
      then pg_catalog.jsonb_build_object('from', v_t.priority, 'to', v_new.priority) end,
    'product_id', case when v_new.product_id is distinct from v_t.product_id
      then pg_catalog.jsonb_build_object('from', v_t.product_id, 'to', v_new.product_id) end,
    'category_id', case when v_new.category_id is distinct from v_t.category_id
      then pg_catalog.jsonb_build_object('from', v_t.category_id, 'to', v_new.category_id) end,
    'customer_id', case when v_new.customer_id is distinct from v_t.customer_id
      then pg_catalog.jsonb_build_object('from', v_t.customer_id, 'to', v_new.customer_id) end,
    'contract_id', case when v_new.contract_id is distinct from v_t.contract_id
      then pg_catalog.jsonb_build_object('from', v_t.contract_id, 'to', v_new.contract_id) end
  ));

  perform public.ticket_record_event(v_new.id, 'ticket.updated', v_actor,
    p_actor_user_id, p_actor_token_id,
    pg_catalog.jsonb_build_object('changes', v_changes)
      || case when v_reason is null then '{}'::jsonb
              else pg_catalog.jsonb_build_object('reason', v_reason) end);

  return pg_catalog.jsonb_build_object('ticket', public.ticket_summary(v_new.id), 'changed', true);
end;
$$;

-- ============================================================================
-- Privilégios de função (os de 20260925120900, repetidos: idempotente)
-- ============================================================================

revoke all on function public.ticket_update(uuid, integer, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ticket_update(uuid, integer, jsonb, uuid, uuid) to service_role;

notify pgrst, 'reload schema';

select public.assert_security_baseline();
