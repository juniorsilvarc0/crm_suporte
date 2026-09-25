-- ---------------------------------------------------------------------------
-- Corrige o claim da outbox de conversões Meta.
--
-- Defeito em 20260711120000_meta_lead_tracking.sql:
--   claim_meta_conversion_outbox reivindicava qualquer item pronto (CTE `ready`),
--   gravava status='processing', incrementava attempt_count e criava lease para
--   TODOS eles, e só então descartava os inelegíveis no SELECT final
--   (`where a.ctwa_clid is not null`).
--
--   Um item inelegível nunca chegava ao worker, logo nunca recebia
--   finish_meta_conversion_outbox_item. Ficava em 'processing' até o lease de 5
--   minutos vencer, era reivindicado de novo, e em oito ciclos (~40 min) virava
--   'dead_letter' com 'retry_exhausted' — sem nunca ter tocado a rede.
--
--   Caminhos que produzem um item ativo inelegível:
--     * attribution_id vira NULL pelo `on delete set null` da FK;
--     * replay de mensagem cuja atribuição já foi redigida — a atribuição mantém
--       ctwa_clid NULL, mas o insert do LeadSubmitted decide o status olhando o
--       p_ctwa_clid do webhook, não o valor persistido.
--
-- Correção:
--   1. o predicado de elegibilidade sobe para a CTE `ready`, via EXISTS — nada
--      inelegível é reivindicado;
--   2. itens ativos inelegíveis são rebaixados para 'skipped', que é o estado
--      semanticamente correto (invariante 18 da especificação) e continua
--      reversível pela promoção em ingest_meta_webhook_message;
--   3. dead letters fantasma já existentes são reclassificados.
--
-- Não destrutiva: nenhuma linha é apagada e nenhuma coluna some. A única
-- mudança de dados é reclassificação de status, descrita no item 3 e no PR.
-- ---------------------------------------------------------------------------

create or replace function public.claim_meta_conversion_outbox(
  p_owner text,
  p_limit integer default 50
)
returns table (
  id uuid,
  event_id text,
  event_name text,
  event_time timestamptz,
  attempt_count integer,
  created_at timestamptz,
  lease_token uuid,
  ctwa_clid text,
  whatsapp_business_id text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Rebaixa itens ativos que não têm click ID elegível. Precede a varredura de
  -- dead letter de propósito: 'skipped' descreve a causa real ("sem click ID"),
  -- enquanto 'retry_exhausted' afirmaria uma entrega que jamais foi tentada.
  --
  -- attempt_count só é zerado quando o item comprovadamente nunca alcançou a
  -- Meta (sem status HTTP e sem resumo de resposta). Nos demais casos o
  -- histórico de tentativas é preservado para diagnóstico.
  update public.meta_conversion_outbox o
  set status = 'skipped',
      attempt_count = case
        when o.last_http_status is null and o.response_summary is null then 0
        else o.attempt_count
      end,
      last_error_category = case
        when o.attribution_id is null then 'missing_attribution'
        else 'missing_ctwa_clid'
      end,
      last_error_message = case
        when o.attribution_id is null
          then 'Atribuição ausente: evento inelegível para CAPI.'
        else 'Click ID indisponível ou redigido: evento inelegível para CAPI.'
      end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where o.status in ('pending', 'retry', 'processing')
    and (o.status <> 'processing' or o.lease_expires_at < now())
    and not exists (
      select 1
      from public.meta_attributions a
      where a.id = o.attribution_id
        and a.ctwa_clid is not null
    );

  update public.meta_conversion_outbox o
  set status = 'dead_letter',
      last_error_category = 'retry_exhausted',
      last_error_message = 'Limite de tentativas ou idade excedido.',
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where o.status in ('pending', 'retry', 'processing')
    and (
      o.attempt_count >= 8
      or coalesce(o.requeued_at, o.created_at) <= now() - interval '72 hours'
    )
    and (o.status <> 'processing' or o.lease_expires_at < now());

  return query
  with ready as (
    select o.id
    from public.meta_conversion_outbox o
    where (
      (o.status in ('pending', 'retry') and o.next_attempt_at <= now())
      or (o.status = 'processing' and o.lease_expires_at < now())
    )
      and o.attempt_count < 8
      and coalesce(o.requeued_at, o.created_at) > now() - interval '72 hours'
      -- EXISTS, não JOIN: o FOR UPDATE abaixo continua travando apenas
      -- meta_conversion_outbox. Um JOIN travaria meta_attributions junto e abriria
      -- espaço para deadlock contra a ingestão e contra a redação.
      and exists (
        select 1
        from public.meta_attributions a
        where a.id = o.attribution_id
          and a.ctwa_clid is not null
      )
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  ), claimed as (
    update public.meta_conversion_outbox o
    set status = 'processing',
        attempt_count = o.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_owner = p_owner,
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
    from ready
    where o.id = ready.id
    returning o.*
  )
  -- Sem filtro pós-claim: `ready` já garantiu a elegibilidade sob o mesmo
  -- snapshot, então o join não descarta nada. Se algum dia descartasse, o efeito
  -- seria uma rejeição visível da Meta em vez de um item preso em silêncio.
  select
    c.id,
    c.event_id,
    c.event_name,
    c.event_time,
    c.attempt_count,
    c.created_at,
    c.lease_token,
    a.ctwa_clid,
    a.whatsapp_business_id
  from claimed c
  join public.meta_attributions a on a.id = c.attribution_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reclassificação única dos dead letters fantasma produzidos pelo defeito.
--
-- Os três predicados de resposta (sent_at, last_http_status, response_summary
-- todos nulos) separam o fantasma de um esgotamento legítimo: qualquer item que
-- realmente falou com a Meta grava status HTTP ou resumo — inclusive falha de
-- transporte, que persiste {"transport_error": true}.
-- ---------------------------------------------------------------------------
update public.meta_conversion_outbox o
set status = 'skipped',
    attempt_count = 0,
    last_error_category = case
      when o.attribution_id is null then 'missing_attribution'
      else 'missing_ctwa_clid'
    end,
    last_error_message = 'Reclassificado: nunca enviado à Meta por falta de click ID elegível.',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    updated_at = now()
where o.status = 'dead_letter'
  and o.last_error_category = 'retry_exhausted'
  and o.sent_at is null
  and o.last_http_status is null
  and o.response_summary is null
  and not exists (
    select 1
    from public.meta_attributions a
    where a.id = o.attribution_id
      and a.ctwa_clid is not null
  );

-- create or replace preserva a ACL da função; reafirmado aqui para a migration
-- ser idempotente e autossuficiente.
revoke all on function public.claim_meta_conversion_outbox(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_meta_conversion_outbox(text, integer)
  to service_role;
