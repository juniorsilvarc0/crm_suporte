-- `chat_conversations.external_id` é o endereço estável do canal, não a chave
-- canônica da pessoa. Evolution/Uazapi já gravam o telefone recebido pelo
-- provedor; o ingest Meta legado gravava `normalized_phone` (sem DDI), que não
-- é um destinatário válido para a Cloud API.

create or replace function public.preserve_meta_conversation_channel_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_provider_phone text;
begin
  select i.provider
    into v_provider
  from public.chat_integrations i
  where i.id = new.integration_id;

  if v_provider <> 'meta' then
    return new;
  end if;

  -- Depois do primeiro INSERT, `providerContactPhone` é o snapshot imutável
  -- capturado pela trigger canônica. No primeiro evento, `contact_phone` ainda
  -- é o valor bruto recebido da Meta. O fallback final mantém compatibilidade
  -- com linhas antigas incompletas sem fabricar um endereço.
  v_provider_phone := nullif(
    regexp_replace(
      coalesce(
        new.metadata ->> 'providerContactPhone',
        new.contact_phone,
        new.external_id
      ),
      '[^0-9]',
      '',
      'g'
    ),
    ''
  );

  if v_provider_phone is not null then
    new.external_id := v_provider_phone;
  end if;

  return new;
end;
$$;

revoke execute on function public.preserve_meta_conversation_channel_identity()
  from public, anon, authenticated;

drop trigger if exists trg_chat_conversations_preserve_meta_channel_identity
  on public.chat_conversations;
create trigger trg_chat_conversations_preserve_meta_channel_identity
  before insert or update of integration_id, external_id, contact_phone
  on public.chat_conversations
  for each row execute function public.preserve_meta_conversation_channel_identity();

-- Repara somente o endereço da conversa. O id, `lead_id`, mensagens, estado e
-- histórico permanecem na mesma linha. Se houver uma colisão real, a unique
-- `(integration_id, external_id)` aborta a migration inteira em vez de mesclar
-- duas conversas silenciosamente.
update public.chat_conversations c
set external_id = regexp_replace(
      coalesce(
        c.metadata ->> 'providerContactPhone',
        c.contact_phone,
        c.external_id
      ),
      '[^0-9]',
      '',
      'g'
    ),
    updated_at = now()
from public.chat_integrations i
where i.id = c.integration_id
  and i.provider = 'meta'
  and nullif(
    regexp_replace(
      coalesce(
        c.metadata ->> 'providerContactPhone',
        c.contact_phone,
        c.external_id
      ),
      '[^0-9]',
      '',
      'g'
    ),
    ''
  ) is not null
  and c.external_id is distinct from regexp_replace(
    coalesce(
      c.metadata ->> 'providerContactPhone',
      c.contact_phone,
      c.external_id
    ),
    '[^0-9]',
    '',
    'g'
  );

notify pgrst, 'reload schema';
