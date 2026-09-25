-- Faz o ingest transacional da Meta usar a mesma identidade canônica dos
-- demais provedores. O contrato da RPC permanece idêntico para o backend.

create or replace function public.ingest_meta_webhook_message(
  p_integration_id uuid,
  p_phone text,
  p_normalized_phone text,
  p_contact_name text,
  p_external_id text,
  p_message_type text,
  p_content text,
  p_media_url text,
  p_media_mime_type text,
  p_message_at timestamptz,
  p_whatsapp_business_id text,
  p_phone_number_id text,
  p_source_id text,
  p_source_type text,
  p_ctwa_clid text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution jsonb;
  v_normalized_phone text;
  v_lead_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_attribution_id uuid;
  v_initial_deal_id uuid;
  v_had_active_deal boolean := false;
  v_is_new_lead boolean := false;
  v_inserted_message boolean := false;
  v_fingerprint text;
  v_source_type text;
begin
  -- `p_normalized_phone` continua na assinatura por compatibilidade e só é
  -- fallback se o telefone cru vier vazio. A normalização efetiva continua
  -- dentro do resolvedor, impedindo divergência entre provedores.
  v_resolution := public.resolve_lead_identity(
    coalesce(nullif(btrim(p_phone), ''), p_normalized_phone),
    p_contact_name,
    case
      when p_source_id is not null or p_ctwa_clid is not null then 'anuncio'
      else 'whatsapp'
    end,
    -- Com integração, somente o INSERT real da mensagem cria/restaura o card
    -- e atualiza a pessoa. Sem integração não há linha idempotente de mensagem,
    -- então preservamos o fallback comercial anterior.
    p_integration_id is null,
    case when p_integration_id is null then p_message_at end,
    p_integration_id is null
  );
  v_lead_id := (v_resolution ->> 'leadId')::uuid;
  v_normalized_phone := v_resolution ->> 'normalizedPhone';
  v_is_new_lead := coalesce((v_resolution ->> 'created')::boolean, false);
  v_initial_deal_id := nullif(v_resolution ->> 'initialDealId', '')::uuid;
  select exists (
    select 1
    from public.deals d
    where d.lead_id = v_lead_id
      and d.removed_at is null
  ) into v_had_active_deal;

  if p_integration_id is not null then
    insert into public.chat_conversations (
      integration_id,
      external_id,
      lead_id,
      contact_name,
      contact_phone,
      last_message_at,
      last_message_preview,
      removed_at,
      updated_at
    ) values (
      p_integration_id,
      v_normalized_phone,
      v_lead_id,
      nullif(p_contact_name, ''),
      p_phone,
      p_message_at,
      left(coalesce(p_content, '[' || p_message_type || ']'), 120),
      null,
      now()
    )
    on conflict (integration_id, external_id) do update
    set lead_id = excluded.lead_id,
        contact_phone = excluded.contact_phone,
        contact_name = coalesce(public.chat_conversations.contact_name, excluded.contact_name),
        updated_at = now()
    returning id into v_conversation_id;

    insert into public.chat_messages (
      conversation_id,
      external_id,
      direction,
      type,
      content,
      media_url,
      media_mime_type,
      delivery_status,
      created_at
    ) values (
      v_conversation_id,
      p_external_id,
      'inbound',
      p_message_type,
      p_content,
      p_media_url,
      p_media_mime_type,
      'delivered',
      p_message_at
    )
    on conflict (conversation_id, external_id) do nothing
    returning id into v_message_id;

    if v_message_id is not null then
      v_inserted_message := true;

      -- O trigger da mensagem cria/restaura a oportunidade apenas no INSERT
      -- real. Recuperamos esse id para manter o vínculo da atribuição Meta.
      if not v_had_active_deal then
        select d.id
          into v_initial_deal_id
        from public.deals d
        where d.lead_id = v_lead_id
          and d.removed_at is null
        order by d.created_at, d.id
        limit 1;
      end if;

    else
      select id into v_message_id
      from public.chat_messages
      where conversation_id = v_conversation_id
        and external_id = p_external_id;
    end if;
  end if;

  if p_source_id is not null or p_ctwa_clid is not null then
    v_source_type := case
      when p_source_type in ('ad', 'post') then p_source_type
      else 'unknown'
    end;

    if p_source_id is not null then
      insert into public.meta_ad_assets (source_id, source_type)
      values (p_source_id, v_source_type)
      on conflict (source_id) do update
      set source_type = case
            when public.meta_ad_assets.source_type = 'unknown'
              then excluded.source_type
            else public.meta_ad_assets.source_type
          end,
          updated_at = now();
    end if;

    if nullif(p_ctwa_clid, '') is not null then
      v_fingerprint := encode(extensions.digest(p_ctwa_clid, 'sha256'), 'hex');
      select id into v_attribution_id
      from public.meta_attributions
      where ctwa_fingerprint = v_fingerprint;
    end if;

    if v_attribution_id is null then
      select id into v_attribution_id
      from public.meta_attributions
      where whatsapp_business_id = p_whatsapp_business_id
        and source_message_id = p_external_id;
    end if;

    if v_attribution_id is null then
      insert into public.meta_attributions (
        lead_id,
        source_message_id,
        whatsapp_business_id,
        phone_number_id,
        source_id,
        source_type,
        ctwa_clid,
        ctwa_fingerprint,
        had_ctwa_clid,
        message_at
      ) values (
        v_lead_id,
        p_external_id,
        p_whatsapp_business_id,
        p_phone_number_id,
        p_source_id,
        v_source_type,
        nullif(p_ctwa_clid, ''),
        v_fingerprint,
        nullif(p_ctwa_clid, '') is not null,
        p_message_at
      )
      returning id into v_attribution_id;
    end if;

    update public.meta_attributions
    set phone_number_id = coalesce(phone_number_id, p_phone_number_id),
        source_id = coalesce(source_id, p_source_id),
        source_type = case
          when source_type = 'unknown' then v_source_type
          else source_type
        end,
        ctwa_clid = case
          when redacted_at is null then coalesce(ctwa_clid, nullif(p_ctwa_clid, ''))
          else ctwa_clid
        end,
        ctwa_fingerprint = coalesce(ctwa_fingerprint, v_fingerprint),
        had_ctwa_clid = had_ctwa_clid or nullif(p_ctwa_clid, '') is not null
    where id = v_attribution_id;

    -- Um lead novo, ou uma pessoa que retornou sem oportunidade ativa, recebe
    -- a atribuição na oportunidade criada/restaurada pelo resolvedor.
    if v_initial_deal_id is not null then
      perform pg_catalog.set_config('app.meta_attribution_link', 'on', true);
      update public.deals
      set meta_attribution_id = v_attribution_id
      where id = v_initial_deal_id
        and meta_attribution_id is null;
      perform pg_catalog.set_config('app.meta_attribution_link', 'off', true);
    end if;

    insert into public.meta_conversion_outbox (
      event_key,
      event_id,
      event_name,
      attribution_id,
      lead_id,
      event_time,
      status,
      last_error_category,
      last_error_message
    ) values (
      'lead-submitted:attribution:' || v_attribution_id::text,
      'crm:meta:LeadSubmitted:attribution:' || v_attribution_id::text,
      'LeadSubmitted',
      v_attribution_id,
      v_lead_id,
      p_message_at,
      case when nullif(p_ctwa_clid, '') is not null then 'pending' else 'skipped' end,
      case when nullif(p_ctwa_clid, '') is null then 'missing_ctwa_clid' end,
      case when nullif(p_ctwa_clid, '') is null then 'Referral sem click ID elegível para CAPI.' end
    )
    on conflict (event_key) do nothing;

    if nullif(p_ctwa_clid, '') is not null then
      update public.meta_conversion_outbox
      set status = 'pending',
          next_attempt_at = now(),
          last_error_category = null,
          last_error_message = null,
          updated_at = now()
      where attribution_id = v_attribution_id
        and status = 'skipped'
        and exists (
          select 1
          from public.meta_attributions a
          where a.id = v_attribution_id
            and a.redacted_at is null
        );
    end if;
  end if;

  return jsonb_build_object(
    'leadId', v_lead_id,
    'conversationId', v_conversation_id,
    'messageId', v_message_id,
    'messageInserted', v_inserted_message,
    'attributionId', v_attribution_id,
    'initialDealId', v_initial_deal_id,
    'newLead', v_is_new_lead
  );
end;
$$;

revoke all on function public.ingest_meta_webhook_message(
  uuid, text, text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.ingest_meta_webhook_message(
  uuid, text, text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text
) to service_role;

-- A troca do contador ocorre na mesma migration da RPC Meta acima. Assim não
-- existe janela de rollout em que o Meta incremente manualmente e por trigger.
-- A função antiga vira no-op porque o app anterior ainda a chama; o trigger
-- incrementa somente INSERT real e retries em ON CONFLICT não inflam o badge.
create or replace function public.increment_unread(conv_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if conv_id is null then
    return;
  end if;
  return;
end;
$$;

revoke execute on function public.increment_unread(uuid)
  from public, anon, authenticated;
grant execute on function public.increment_unread(uuid)
  to service_role;

create or replace function public.increment_unread_from_inserted_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview text;
begin
  v_preview := case new.type
    when 'image' then rtrim('[image] ' || coalesce(new.content, ''))
    when 'audio' then '[audio]'
    when 'video' then rtrim('[video] ' || coalesce(new.content, ''))
    when 'document' then rtrim('[document] ' || coalesce(new.content, ''))
    when 'sticker' then '[sticker]'
    when 'contact' then rtrim('[contact] ' || coalesce(new.content, ''))
    else coalesce(new.content, '')
  end;

  update public.chat_conversations
  set unread_count = unread_count + case
        when new.direction = 'inbound'
         and (
           removed_at is null
           or new.created_at > removed_at
         ) then 1
        else 0
      end,
      last_message_preview = case
        when last_message_at is null or new.created_at >= last_message_at
          then left(v_preview, 120)
        else last_message_preview
      end,
      last_message_at = greatest(
        coalesce(last_message_at, new.created_at),
        new.created_at
      ),
      removed_at = case
        when removed_at is not null and new.created_at <= removed_at
          then removed_at
        else null
      end,
      updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

revoke execute on function public.increment_unread_from_inserted_message()
  from public, anon, authenticated;

drop trigger if exists trg_chat_messages_increment_unread
  on public.chat_messages;
create trigger trg_chat_messages_increment_unread
  after insert on public.chat_messages
  for each row execute function public.increment_unread_from_inserted_message();

notify pgrst, 'reload schema';
