-- A migration de identidade precisou criar uma pessoa persistente para cada
-- conversa legada sem correspondência. Conversas antigas somente de saída,
-- porém, não representam uma entrada ativa em Leads até existir interação do
-- contato ou vínculo comercial.
--
-- O critério abaixo identifica somente pessoas sintetizadas depois de todas as
-- suas conversas e sem qualquer contexto comercial. A identidade e a conversa
-- permanecem intactas; um inbound futuro remove `archived_at` pela trigger
-- `ensure_inbound_lead_deal` e recupera a mesma pessoa.

with backfilled_placeholders as (
  select l.id
  from public.leads l
  where l.archived_at is null
    and l.source = 'whatsapp'
    and nullif(btrim(l.name), '') is null
    and exists (
      select 1
      from public.chat_conversations c
      where c.lead_id = l.id
        and c.created_at < l.created_at
    )
    and not exists (
      select 1
      from public.chat_conversations c
      where c.lead_id = l.id
        and c.created_at >= l.created_at
    )
    and not exists (
      select 1
      from public.chat_conversations c
      join public.chat_messages m on m.conversation_id = c.id
      where c.lead_id = l.id
        and m.direction = 'inbound'
    )
    and not exists (select 1 from public.deals d where d.lead_id = l.id)
    and not exists (select 1 from public.appointments a where a.lead_id = l.id)
    and not exists (select 1 from public.contracts c where c.lead_id = l.id)
    and not exists (
      select 1 from public.deal_stage_history h where h.lead_id = l.id
    )
    and not exists (select 1 from public.followups f where f.lead_id = l.id)
    and not exists (select 1 from public.lead_tags t where t.lead_id = l.id)
    and not exists (
      select 1 from public.meta_attributions a where a.lead_id = l.id
    )
    and not exists (
      select 1 from public.meta_conversion_outbox o where o.lead_id = l.id
    )
    and not exists (select 1 from public.payments p where p.lead_id = l.id)
)
update public.leads l
set archived_at = now(),
    updated_at = now()
from backfilled_placeholders p
where l.id = p.id
  and l.archived_at is null;
