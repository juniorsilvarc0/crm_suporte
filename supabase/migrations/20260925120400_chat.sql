-- ============================================================================
-- Baseline 5/6 — Chat do WhatsApp (uazapi).
--
-- Porta o chat da origem (CRM da clínica) para o domínio de suporte. A pessoa
-- que escreve é o CONTATO (`contacts`, `contact_id`); o dono do atendimento é
-- `chat_conversations.status` (bot|human|resolved), eixo independente do status
-- do ticket (plano §A.1).
--
-- Sempre a ÚLTIMA definição de cada objeto na origem:
--   20260622_chat_module.sql                        tabelas e checks
--   20260706150000_chat_media_and_realtime.sql      índice em external_id
--   20260706160000 + 20260809111000:291-370         não lidas por trigger
--   20260807151000_unifica_respostas_rapidas        respostas rápidas
--   20260807160000 / 20260808233000                 arquivar / fixar
--   20260808120000_etiquetas_de_conversa            conversation_tags
--   20260809110000:34-40, 840-948, 1052-1121, 1211-1310, 1361-1420
--                                                   contato canônico, eventos,
--                                                   limpar conversa
--   20260714150000:99                               autor da mensagem
--
-- NÃO portado, de propósito:
--   - 20260810160000 (preservar endereço do canal): só agia com
--     provider = 'meta'; com o check só-uazapi seria código morto. A regra que
--     ele protegia (external_id é o endereço do canal, com DDI, e não a chave
--     da pessoa) fica no comentário da coluna;
--   - RPC `increment_unread` (no-op na origem) e o ramo de deal de
--     `ensure_inbound_lead_deal`;
--   - índices da origem sem consumidor no TS (status, created_at global,
--     removed_at); o de fixadas virou parte de `chat_conversations_inbox_idx`.
--
-- Depende de:
--   _fundacao  set_updated_at(), assert_security_baseline(), pg_trgm em `extensions`
--   _usuarios  app_users
--   _contatos  contacts(name, phone, archived_at, last_message_at, updated_at),
--              contact_events(contact_id, event_type, entity_type, entity_id,
--              event_key, metadata, occurred_at) com único em event_key,
--              tags, resolve_contact_identity(p_phone, p_name, p_reactivate …)
--              → jsonb com `contactId`
--
-- Fora daqui, de propósito: o SELECT de `authenticated`, a policy por
-- `app_role` e a publication ficam em _storage_realtime. São uma decisão de
-- segurança só (blindagem_anon.sql:119-167) e moram juntas.
-- ============================================================================

-- Guarda: os índices de busca abaixo usam `extensions.gin_trgm_ops`. A
-- _fundacao já instala; aqui é no-op, e falha alto se a extensão tiver ido
-- parar em outro schema, em vez de criar índice nenhum.
create extension if not exists pg_trgm with schema extensions;

-- Pré-requisitos: sem _contatos, os FKs e triggers abaixo falhariam com um
-- "relation does not exist" genérico. Aqui a falha diz o que falta.
do $$
begin
  if pg_catalog.to_regclass('public.contacts') is null
     or pg_catalog.to_regclass('public.contact_events') is null
     or pg_catalog.to_regclass('public.tags') is null then
    raise exception 'chat: aplique 20260925120300_contatos antes (contacts, contact_events, tags)';
  end if;
  if pg_catalog.to_regclass('public.app_users') is null then
    raise exception 'chat: aplique 20260925120100_usuarios antes (app_users)';
  end if;
  if pg_catalog.to_regprocedure('public.resolve_contact_identity(text,text,text,timestamptz,boolean)') is null then
    raise exception 'chat: public.resolve_contact_identity(text,text,text,timestamptz,boolean) não existe';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 1. Integrações (uma linha por conta de WhatsApp).
-- ----------------------------------------------------------------------------
create table if not exists public.chat_integrations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  provider          text not null,
  phone_number      text,
  config            jsonb not null default '{}'::jsonb,
  token_secret_id   uuid,
  webhook_secret_id uuid,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chat_integrations_name_not_blank check (btrim(name) <> ''),
  -- Só uazapi (decisão 4 do plano: um número, um provedor). A Fase 1 tirou do
  -- código os webhooks e senders de Evolution e Meta; uma linha de outro
  -- provedor ficaria sem ninguém para atendê-la. Ampliar é migration aditiva.
  constraint chat_integrations_provider_check check (provider in ('uazapi')),
  -- Um número por provedor na v1. O `persist` da Conexão faz SELECT e depois
  -- INSERT: dois cliques simultâneos criariam duas integrações, e o webhook
  -- não saberia qual segredo vale.
  constraint chat_integrations_provider_key unique (provider),
  constraint chat_integrations_config_is_object check (jsonb_typeof(config) = 'object'),
  -- `config` é lido por toda rota de envio; segredo não mora nele. O token da
  -- uazapi ia em `config.token` na origem, lido direto em 7 lugares. A trava
  -- impede que esse caminho volte por engano: segredo só pelo Vault (§9).
  constraint chat_integrations_config_without_secret check (
    not (config ?| array[
      'token', 'adminToken', 'admintoken', 'apiKey', 'apikey', 'api_key',
      'secret', 'webhookSecret', 'webhook_secret', 'password'
    ])
  ),
  -- Mesmo desenho de app_environment_variables (20260811140000): a tabela
  -- guarda só o id do segredo; o valor cifrado fica no Vault.
  constraint chat_integrations_token_secret_id_key unique (token_secret_id),
  constraint chat_integrations_webhook_secret_id_key unique (webhook_secret_id)
);

-- ----------------------------------------------------------------------------
-- 2. Conversas (uma por contato por integração).
-- ----------------------------------------------------------------------------
create table if not exists public.chat_conversations (
  id                   uuid primary key default gen_random_uuid(),
  integration_id       uuid,
  contact_id           uuid not null,
  external_id          text not null,
  contact_name         text,
  contact_phone        text,
  contact_avatar_url   text,
  status               text not null default 'bot',
  unread_count         integer not null default 0,
  last_message_at      timestamptz,
  last_message_preview text,
  archived_at          timestamptz,
  pinned_at            timestamptz,
  removed_at           timestamptz,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- `disconnect` apaga as conversas antes da integração, mas o set null é a
  -- rede se a ordem inverter (20260622_chat_module.sql).
  constraint chat_conversations_integration_id_fkey
    foreign key (integration_id) references public.chat_integrations (id) on delete set null,
  -- Toda conversa tem dono canônico, e o contato não some por cascata
  -- (20260809110000:1009-1016). É a única FK entre as duas tabelas, então o
  -- embed `contact:contacts(name, phone)` do PostgREST não fica ambíguo.
  constraint chat_conversations_contact_id_fkey
    foreign key (contact_id) references public.contacts (id) on delete restrict,
  -- NÃO parcial: é o alvo do `onConflict: integration_id,external_id` do
  -- upsert do webhook, e o PostgREST só infere índice não parcial.
  constraint chat_conversations_integration_id_external_id_key
    unique (integration_id, external_id),
  constraint chat_conversations_external_id_not_blank check (btrim(external_id) <> ''),
  constraint chat_conversations_status_check check (status in ('bot', 'human', 'resolved')),
  constraint chat_conversations_unread_count_check check (unread_count >= 0)
);

-- ----------------------------------------------------------------------------
-- 3. Mensagens.
-- ----------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null,
  external_id       text,
  direction         text not null,
  sender_type       text not null,
  type              text not null default 'text',
  content           text,
  media_url         text,
  media_mime_type   text,
  media_bucket      text,
  media_key         text,
  quoted_message_id uuid,
  delivery_status   text not null default 'pending',
  sent_by_user_id   uuid,
  is_deleted        boolean not null default false,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  constraint chat_messages_conversation_id_fkey
    foreign key (conversation_id) references public.chat_conversations (id) on delete cascade,
  constraint chat_messages_quoted_message_id_fkey
    foreign key (quoted_message_id) references public.chat_messages (id) on delete set null,
  -- A origem não tinha FK e `delete_app_user` limpava na mão
  -- (20260714150000:99). A FK faz o mesmo sem depender de quem apaga; o UPDATE
  -- manual que sobrar na RPC fica inofensivo.
  constraint chat_messages_sent_by_user_id_fkey
    foreign key (sent_by_user_id) references public.app_users (id) on delete set null,
  -- Dedup do webhook: retry da uazapi cai no ON CONFLICT DO NOTHING e não
  -- dispara os triggers de INSERT. NÃO parcial pelo mesmo motivo do
  -- `onConflict` acima. `external_id` nulo (nota, envio pendente) não colide:
  -- NULLs são distintos.
  constraint chat_messages_conversation_id_external_id_key
    unique (conversation_id, external_id),
  constraint chat_messages_direction_check check (direction in ('inbound', 'outbound')),
  -- Quem escreveu. `device` = mensagem enviada pelo celular da empresa, fora
  -- do CRM (eco fromMe sem track_id). A 1ª resposta do SLA (Fase 4) conta só
  -- `agent`; a da IA fica à parte (decisão 3 do plano).
  constraint chat_messages_sender_type_check
    check (sender_type in ('contact', 'agent', 'ai', 'system', 'device')),
  -- Entrada é sempre do contato, e só ela. Sem isto, um sender esquecido no TS
  -- contaria como resposta do analista, ou o contrário.
  constraint chat_messages_sender_direction_check
    check ((direction = 'inbound') = (sender_type = 'contact')),
  constraint chat_messages_type_check check (type in (
    'text', 'image', 'audio', 'video', 'document', 'sticker', 'contact', 'template', 'note'
  )),
  constraint chat_messages_delivery_status_check check (delivery_status in (
    'pending', 'sent', 'delivered', 'read', 'failed'
  )),
  -- Nota interna nunca vai ao provedor. Sem `external_id`, os UPDATEs do
  -- webhook (que casam só por external_id, sem conversa) não a alcançam.
  constraint chat_messages_note_is_local
    check (type <> 'note' or (direction = 'outbound' and external_id is null)),
  -- Mídia privada é endereçada por bucket + chave; um sem o outro não assina.
  -- O `is not null` explícito importa: CHECK que dá NULL passa.
  constraint chat_messages_media_object_pair check (
    (media_bucket is null and media_key is null)
    or (
      media_bucket is not null and media_key is not null
      and btrim(media_bucket) <> '' and btrim(media_key) <> ''
    )
  )
);

-- ----------------------------------------------------------------------------
-- 4. Etiquetas de conversa (20260808120000). Reusa `tags`: o mesmo vocabulário
--    para contato e conversa.
-- ----------------------------------------------------------------------------
create table if not exists public.conversation_tags (
  conversation_id uuid not null,
  tag_id          uuid not null,
  created_at      timestamptz not null default now(),
  -- A PK é o alvo do `onConflict: conversation_id,tag_id`.
  constraint conversation_tags_pkey primary key (conversation_id, tag_id),
  constraint conversation_tags_conversation_id_fkey
    foreign key (conversation_id) references public.chat_conversations (id) on delete cascade,
  constraint conversation_tags_tag_id_fkey
    foreign key (tag_id) references public.tags (id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 5. Respostas rápidas (última forma: 20260807151000).
-- ----------------------------------------------------------------------------
create table if not exists public.chat_quick_replies (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  shortcut           text not null,
  content            text not null,
  is_active          boolean not null default true,
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chat_quick_replies_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint chat_quick_replies_title_not_blank check (btrim(title) <> ''),
  constraint chat_quick_replies_title_length check (char_length(title) <= 80),
  constraint chat_quick_replies_shortcut_format check (shortcut ~ '^[a-z0-9_-]{1,40}$'),
  constraint chat_quick_replies_content_not_blank check (btrim(content) <> ''),
  constraint chat_quick_replies_content_length check (char_length(content) <= 4000)
);

-- ----------------------------------------------------------------------------
-- 6. Índices.
-- ----------------------------------------------------------------------------

-- Caixa de entrada: exatamente o filtro e a ordem de
-- `api/chat/conversations/route.ts` (fixadas primeiro, depois a mais recente).
create index if not exists chat_conversations_inbox_idx
  on public.chat_conversations (pinned_at desc nulls last, last_message_at desc nulls last)
  where removed_at is null and archived_at is null;

-- Caixa de arquivadas e a contagem que o navegador faz (20260807160000).
create index if not exists chat_conversations_archived_last_message_idx
  on public.chat_conversations (last_message_at desc nulls last)
  where archived_at is not null;

-- Conversas de um contato; cobre também a FK restrict (20260809110000:38-40).
create index if not exists chat_conversations_contact_id_idx
  on public.chat_conversations (contact_id, last_message_at desc nulls last);

-- Busca da lista: `contact_name ilike %t% or contact_phone ilike %t%`.
-- Sem trigram, todo termo digitado varre a tabela.
create index if not exists chat_conversations_contact_name_trgm_idx
  on public.chat_conversations using gin (contact_name extensions.gin_trgm_ops)
  where removed_at is null;
create index if not exists chat_conversations_contact_phone_trgm_idx
  on public.chat_conversations using gin (contact_phone extensions.gin_trgm_ops)
  where removed_at is null;

-- Paginação por cursor `(created_at desc, id desc)` dentro da conversa; cobre
-- também a FK cascade.
create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at desc, id desc);

-- O webhook casa status, eco e exclusão só por external_id, sem conversa
-- (20260706150000:31-33). Parcial: nota e envio pendente não têm external_id.
create index if not exists idx_chat_messages_external_id
  on public.chat_messages (external_id)
  where external_id is not null;

-- "O mesmo clientId nunca vira duas mensagens" (send/route.ts:96-110) era só
-- da aplicação: clique duplo simultâneo passava no SELECT e mandava duas vezes
-- ao cliente. O único faz o segundo INSERT falhar com 23505.
create unique index if not exists chat_messages_client_id_uidx
  on public.chat_messages (conversation_id, (metadata ->> 'clientId'))
  where (metadata ->> 'clientId') is not null;

-- FKs com ação: sem índice, apagar uma conversa varre as mensagens uma vez
-- por mensagem citada, e apagar um usuário varre a tabela inteira.
create index if not exists chat_messages_quoted_message_id_idx
  on public.chat_messages (quoted_message_id)
  where quoted_message_id is not null;
create index if not exists chat_messages_sent_by_user_id_idx
  on public.chat_messages (sent_by_user_id)
  where sent_by_user_id is not null;

-- Filtro por etiqueta; a PK cobre o caminho inverso (20260808120000).
create index if not exists conversation_tags_tag_id_idx
  on public.conversation_tags (tag_id);

-- 23505 → 409 "atalho em uso" nas rotas de respostas rápidas.
create unique index if not exists chat_quick_replies_shortcut_lower_uidx
  on public.chat_quick_replies (lower(shortcut));
create index if not exists chat_quick_replies_active_title_idx
  on public.chat_quick_replies (is_active, lower(title));
create index if not exists chat_quick_replies_created_by_user_id_idx
  on public.chat_quick_replies (created_by_user_id);

-- ----------------------------------------------------------------------------
-- 7. RLS e grants.
--
-- RLS ligada e NENHUMA policy aqui: só a service role (que ignora RLS) lê e
-- escreve. As duas exceções de Realtime ganham policy em _storage_realtime.
-- ----------------------------------------------------------------------------
alter table public.chat_integrations  enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.conversation_tags  enable row level security;
alter table public.chat_quick_replies enable row level security;

revoke all on public.chat_integrations, public.conversation_tags, public.chat_quick_replies
  from public, anon, authenticated;

-- Nas duas tabelas de Realtime, `authenticated` perde tudo MENOS o SELECT: é
-- _storage_realtime quem o concede, e reaplicar este arquivo não pode derrubar
-- a lista do chat.
revoke all on public.chat_conversations, public.chat_messages from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on public.chat_conversations, public.chat_messages from authenticated;
do $$
begin
  -- MAINTAIN existe a partir do PG17 (a imagem é 17.6).
  if pg_catalog.current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.chat_conversations, public.chat_messages from authenticated';
  end if;
end
$$;

-- service_role: revoga tudo e devolve só o que o servidor usa (padrão de
-- 20260809110000:105-110). O que não está escrito aqui fica fechado.
revoke all on public.chat_integrations, public.chat_conversations, public.chat_messages,
  public.conversation_tags, public.chat_quick_replies
  from service_role;

-- Integração: as colunas de segredo ficam FORA do INSERT/UPDATE. Só as RPCs
-- do Vault (§9) as gravam; assim ninguém aponta a integração para o segredo
-- de outra coisa e depois o lê pelo getter.
grant select, delete on public.chat_integrations to service_role;
grant insert (name, provider, phone_number, config, is_active, updated_at)
  on public.chat_integrations to service_role;
grant update (name, phone_number, config, is_active, updated_at)
  on public.chat_integrations to service_role;

-- Conversa: o upsert do webhook é ON CONFLICT DO UPDATE; `disconnect` apaga.
grant select, insert, update, delete on public.chat_conversations to service_role;

-- Mensagem: sem DELETE (some só pela cascata da conversa). Direção, autor,
-- tipo, conversa e data são fixos depois do INSERT: é o histórico que o SLA
-- da Fase 4 vai ler. O upsert do webhook é DO NOTHING, então basta INSERT.
grant select, insert on public.chat_messages to service_role;
grant update (
  external_id, content, media_url, media_mime_type, media_bucket, media_key,
  delivery_status, is_deleted, metadata
) on public.chat_messages to service_role;

-- Sem UPDATE: a linha é só a chave, igual a `contact_tags` (_contatos). O
-- upsert do supabase-js precisa de `ignoreDuplicates: true` (ON CONFLICT DO
-- NOTHING); sem ele vira DO UPDATE e falha com 42501.
grant select, insert, delete on public.conversation_tags to service_role;
grant select, insert, update, delete on public.chat_quick_replies to service_role;

-- ----------------------------------------------------------------------------
-- 8. Triggers.
--
-- ⚠️ O Postgres dispara triggers do mesmo momento em ORDEM ALFABÉTICA de nome.
-- Dois nomes abaixo dependem disso; estão marcados.
-- ----------------------------------------------------------------------------

-- 8.1 Rede de segurança: conversa inserida sem contato passa pelo resolvedor
-- (20260809110000:840-874). Nenhum caminho do TS faz isso hoje; a trigger
-- mantém a regra "toda conversa aponta para o contato canônico do telefone"
-- para quem escrever depois. Retorna na 1ª linha quando o contato já veio.
create or replace function public.ensure_chat_conversation_contact()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if new.contact_id is not null then
    return new;
  end if;

  -- Sem reativar: quem reativa é o INSERT real da mensagem (8.5).
  v_result := public.resolve_contact_identity(
    p_phone => coalesce(new.contact_phone, new.external_id),
    p_name => new.contact_name,
    p_reactivate => false
  );
  new.contact_id := (v_result ->> 'contactId')::uuid;
  return new;
end;
$$;

-- 8.2 A conversa guarda o snapshot do provedor em `metadata` e exibe o nome e
-- o telefone do contato canônico (20260809110000:876-909). É isto que faz o
-- payload do Realtime chegar com o nome certo; o embed só cobre o GET.
create or replace function public.sync_conversation_canonical_contact()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_phone text;
begin
  select c.name, c.phone
    into v_name, v_phone
  from public.contacts c
  where c.id = new.contact_id;

  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'providerContactName', coalesce(
        new.metadata ->> 'providerContactName',
        new.contact_name
      ),
      'providerContactPhone', coalesce(
        new.metadata ->> 'providerContactPhone',
        new.contact_phone
      )
    ));
  new.contact_name := coalesce(v_name, new.contact_name);
  new.contact_phone := coalesce(v_phone, new.contact_phone);
  return new;
end;
$$;

-- 8.3 Editar o contato reflete nas conversas dele (20260809110000:911-930).
-- O telefone é imutável em _contatos; o nome é o caso real.
create or replace function public.propagate_contact_to_conversations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.name is not distinct from new.name
     and old.phone is not distinct from new.phone then
    return new;
  end if;

  update public.chat_conversations
  set contact_name = coalesce(new.name, contact_name),
      contact_phone = coalesce(new.phone, contact_phone),
      updated_at = now()
  where contact_id = new.id;
  return new;
end;
$$;

-- 8.4 Marcos da conversa na linha do tempo do contato
-- (20260809110000:1211-1249). `contact_events` é append-only e de outro
-- arquivo: SECURITY DEFINER para gravar sem depender do grant de quem chama.
create or replace function public.record_conversation_contact_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'conversation.started';
  elsif old.removed_at is distinct from new.removed_at then
    v_event_type := case
      when new.removed_at is null then 'conversation.restored'
      else 'conversation.removed'
    end;
  elsif old.archived_at is distinct from new.archived_at then
    v_event_type := case
      when new.archived_at is null then 'conversation.unarchived'
      else 'conversation.archived'
    end;
  else
    return new;
  end if;

  insert into public.contact_events (
    contact_id, event_type, entity_type, entity_id, event_key, occurred_at
  ) values (
    new.contact_id,
    v_event_type,
    'conversation',
    new.id,
    case when tg_op = 'INSERT' then 'conversation.started:' || new.id::text end,
    case when tg_op = 'INSERT' then new.created_at else now() end
  )
  on conflict (event_key) where event_key is not null do nothing;
  return new;
end;
$$;

-- 8.5 O INSERT real da mensagem é a autoridade da interação: toca o contato e
-- o reativa em entrada nova (ensure_inbound_lead_deal, 20260809110000:1049-1112,
-- SEM o ramo que criava deal). Retry do webhook cai no DO NOTHING e não chega
-- aqui. Nota interna não é interação com o contato.
-- SECURITY DEFINER: grava em `contacts`, cujos grants são de _contatos.
create or replace function public.touch_contact_from_inserted_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_archived_at timestamptz;
  v_reactivate boolean;
begin
  if new.type = 'note' then
    return new;
  end if;

  select c.contact_id, ct.archived_at
    into v_contact_id, v_archived_at
  from public.chat_conversations c
  join public.contacts ct on ct.id = c.contact_id
  where c.id = new.conversation_id;

  if v_contact_id is null then
    return new;
  end if;

  v_reactivate := new.direction = 'inbound'
    and v_archived_at is not null
    and new.created_at > v_archived_at;

  -- O WHERE extra só evita reescrever a linha (e mexer em `updated_at`) quando
  -- nada muda: mensagem antiga fora de ordem não é atividade nova.
  update public.contacts
  set last_message_at = greatest(
        coalesce(last_message_at, new.created_at),
        new.created_at
      ),
      archived_at = case when v_reactivate then null else archived_at end,
      updated_at = now()
  where id = v_contact_id
    and (
      last_message_at is null
      or new.created_at > last_message_at
      or v_reactivate
    );

  return new;
end;
$$;

-- 8.6 Prévia, ordem da lista e não lidas (20260809111000:314-361). O contador
-- é atômico no UPDATE e só sobe em INSERT real: retry em DO NOTHING não infla o
-- badge. Substitui a RPC `increment_unread`, que virou no-op na origem e não
-- existe neste baseline.
--
-- Diferença deliberada da origem: nota interna não vira prévia, não reordena a
-- lista nem restaura conversa removida. A origem caía no `else` do CASE e
-- mostrava a nota como prévia, contra o que `messages/[messageId]/route.ts`
-- afirma ("nota não vira prévia").
create or replace function public.increment_unread_from_inserted_message()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_preview text;
begin
  if new.type = 'note' then
    return new;
  end if;

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

-- 8.7 Mensagem apagada não guarda conteúdo, em nenhum caminho (webhook,
-- rota de exclusão, limpar conversa). Com mídia privada, `media_key` é o que
-- permite assinar a URL: sobrar a chave numa mensagem apagada seria servir o
-- arquivo apagado. Transcrição, miniatura, prévia de link e nome do arquivo
-- também são conteúdo.
create or replace function public.scrub_deleted_chat_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_deleted then
    new.content := null;
    new.media_url := null;
    new.media_bucket := null;
    new.media_key := null;
    new.metadata := new.metadata
      - array['transcription', 'thumbUrl', 'linkPreview', 'fileName'];
  end if;
  return new;
end;
$$;

-- 8.8 Apagar a integração apaga os segredos dela no Vault. Sem isto, o token
-- da uazapi desconectada ficaria cifrado para sempre, sem dono.
create or replace function public.delete_chat_integration_vault_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets s
  where s.id in (old.token_secret_id, old.webhook_secret_id);
  return old;
end;
$$;

-- ⚠️ ORDEM: `ensure_contact` (e…) roda antes de `sync_canonical_contact` (s…),
-- que precisa do contact_id resolvido.
drop trigger if exists trg_chat_conversations_ensure_contact on public.chat_conversations;
create trigger trg_chat_conversations_ensure_contact
  before insert or update of contact_id, contact_phone, external_id
  on public.chat_conversations
  for each row execute function public.ensure_chat_conversation_contact();

drop trigger if exists trg_chat_conversations_sync_canonical_contact on public.chat_conversations;
create trigger trg_chat_conversations_sync_canonical_contact
  before insert or update of contact_id, contact_name, contact_phone
  on public.chat_conversations
  for each row execute function public.sync_conversation_canonical_contact();

drop trigger if exists trg_chat_conversations_record_contact_event on public.chat_conversations;
create trigger trg_chat_conversations_record_contact_event
  after insert or update of removed_at, archived_at on public.chat_conversations
  for each row execute function public.record_conversation_contact_event();

drop trigger if exists trg_contacts_propagate_to_conversations on public.contacts;
create trigger trg_contacts_propagate_to_conversations
  after update of name, phone on public.contacts
  for each row execute function public.propagate_contact_to_conversations();

-- ⚠️ ORDEM: `ensure_contact_activity` (e…) roda antes de `increment_unread`
-- (i…). Assim a mensagem trava `contacts` e DEPOIS `chat_conversations`, na
-- mesma ordem de quem renomeia o contato (8.3). Ordem invertida = deadlock
-- entre uma mensagem chegando e uma edição de nome. É a ordem da origem
-- (trg_chat_messages_ensure_inbound_deal < trg_chat_messages_increment_unread).
drop trigger if exists trg_chat_messages_ensure_contact_activity on public.chat_messages;
create trigger trg_chat_messages_ensure_contact_activity
  after insert on public.chat_messages
  for each row execute function public.touch_contact_from_inserted_message();

drop trigger if exists trg_chat_messages_increment_unread on public.chat_messages;
create trigger trg_chat_messages_increment_unread
  after insert on public.chat_messages
  for each row execute function public.increment_unread_from_inserted_message();

drop trigger if exists trg_chat_messages_scrub_deleted on public.chat_messages;
create trigger trg_chat_messages_scrub_deleted
  before insert or update on public.chat_messages
  for each row execute function public.scrub_deleted_chat_message();

drop trigger if exists trg_chat_integrations_delete_vault_secrets on public.chat_integrations;
create trigger trg_chat_integrations_delete_vault_secrets
  after delete on public.chat_integrations
  for each row execute function public.delete_chat_integration_vault_secrets();

drop trigger if exists trg_chat_quick_replies_set_updated_at on public.chat_quick_replies;
create trigger trg_chat_quick_replies_set_updated_at
  before update on public.chat_quick_replies
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 9. RPCs (só service_role).
-- ----------------------------------------------------------------------------

-- 9.1 Limpar a conversa apaga o conteúdo e registra o marco na MESMA
-- transação: se algo falhar, nada fica pela metade (20260809110000:1359-1420).
-- Erro P0002 → 404 na rota. O evento vai para `contact_events`.
-- Fase 4: passa a recusar conversa com ticket (plano §E, Fase 2/4).
create or replace function public.clear_chat_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.chat_conversations%rowtype;
  v_cleared integer := 0;
begin
  perform 1
  from public.chat_conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception 'conversation_not_found'
      using errcode = 'P0002';
  end if;

  -- O trigger 8.7 zera mídia, chave e metadados de conteúdo.
  update public.chat_messages
  set is_deleted = true,
      content = null,
      media_url = null
  where conversation_id = p_conversation_id
    and is_deleted = false;
  get diagnostics v_cleared = row_count;

  update public.chat_conversations
  set last_message_at = null,
      last_message_preview = null,
      unread_count = 0,
      updated_at = now()
  where id = p_conversation_id
  returning * into v_conversation;

  insert into public.contact_events (
    contact_id, event_type, entity_type, entity_id, metadata, occurred_at
  ) values (
    v_conversation.contact_id,
    'conversation.cleared',
    'conversation',
    v_conversation.id,
    jsonb_build_object('clearedMessages', v_cleared),
    now()
  );

  return jsonb_build_object(
    'conversation', to_jsonb(v_conversation),
    'cleared', v_cleared
  );
end;
$$;

-- 9.2 Grava (ou troca) um segredo da integração no Vault. Mesmo molde de
-- set_app_environment_variable (20260811140000): valor nunca em tabela
-- pública, só o id. `p_kind`: 'token' (token da instância uazapi) ou
-- 'webhook_secret' (o `?s=` do webhook). Trocar = chamar de novo.
create or replace function public.set_chat_integration_secret(
  p_integration_id uuid,
  p_kind text,
  p_value text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_secret_id uuid;
  v_name text;
  v_description constant text := 'Gerenciado pelo CRM Suporte (menu Conexão)';
begin
  if v_kind not in ('token', 'webhook_secret') then
    raise exception 'invalid_chat_integration_secret_kind'
      using errcode = '22023';
  end if;

  if p_value is null or length(p_value) = 0 or length(p_value) > 4096 then
    raise exception 'invalid_chat_integration_secret_value'
      using errcode = '22023';
  end if;

  -- A trava da linha serializa duas gravações do mesmo segredo: a segunda
  -- enxerga o id que a primeira gravou e atualiza em vez de criar outro.
  select case v_kind when 'token' then i.token_secret_id else i.webhook_secret_id end
    into v_secret_id
  from public.chat_integrations i
  where i.id = p_integration_id
  for update;

  if not found then
    raise exception 'chat_integration_not_found'
      using errcode = 'P0002';
  end if;

  -- Id apontando para segredo que sumiu do Vault: recria em vez de "atualizar"
  -- nada e responder sucesso.
  if v_secret_id is not null
     and not exists (select 1 from vault.secrets s where s.id = v_secret_id) then
    v_secret_id := null;
  end if;

  v_name := 'crm_suporte_chat_integration.' || p_integration_id::text || '.' || v_kind;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_value, v_name, v_description);

    update public.chat_integrations
    set token_secret_id = case when v_kind = 'token' then v_secret_id else token_secret_id end,
        webhook_secret_id = case when v_kind = 'webhook_secret' then v_secret_id else webhook_secret_id end,
        updated_at = now()
    where id = p_integration_id;
  else
    perform vault.update_secret(v_secret_id, p_value, v_name, v_description);

    update public.chat_integrations
    set updated_at = now()
    where id = p_integration_id;
  end if;

  return true;
end;
$$;

-- 9.3 Lê um segredo da integração. Nulo = não configurado: quem chama falha
-- fechado (401 no webhook, 503 no envio), sem cair para env (plano §A.4).
create or replace function public.get_chat_integration_secret(
  p_integration_id uuid,
  p_kind text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_value text;
begin
  if v_kind not in ('token', 'webhook_secret') then
    raise exception 'invalid_chat_integration_secret_kind'
      using errcode = '22023';
  end if;

  select d.decrypted_secret
    into v_value
  from public.chat_integrations i
  join vault.decrypted_secrets d
    on d.id = case v_kind when 'token' then i.token_secret_id else i.webhook_secret_id end
  where i.id = p_integration_id;

  return v_value;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. EXECUTE: fechado para PUBLIC/anon/authenticated em TODA função, inclusive
-- as de trigger (blindagem_anon.sql:180-207 — revogar só de anon não fecha
-- nada, o EXECUTE nasce em PUBLIC).
-- ----------------------------------------------------------------------------
revoke all on function public.ensure_chat_conversation_contact() from public, anon, authenticated;
revoke all on function public.sync_conversation_canonical_contact() from public, anon, authenticated;
revoke all on function public.propagate_contact_to_conversations() from public, anon, authenticated;
revoke all on function public.record_conversation_contact_event() from public, anon, authenticated;
revoke all on function public.touch_contact_from_inserted_message() from public, anon, authenticated;
revoke all on function public.increment_unread_from_inserted_message() from public, anon, authenticated;
revoke all on function public.scrub_deleted_chat_message() from public, anon, authenticated;
revoke all on function public.delete_chat_integration_vault_secrets() from public, anon, authenticated;
revoke all on function public.clear_chat_conversation(uuid) from public, anon, authenticated;
revoke all on function public.set_chat_integration_secret(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_chat_integration_secret(uuid, text) from public, anon, authenticated;

grant execute on function public.ensure_chat_conversation_contact() to service_role;
grant execute on function public.sync_conversation_canonical_contact() to service_role;
grant execute on function public.propagate_contact_to_conversations() to service_role;
grant execute on function public.record_conversation_contact_event() to service_role;
grant execute on function public.touch_contact_from_inserted_message() to service_role;
grant execute on function public.increment_unread_from_inserted_message() to service_role;
grant execute on function public.scrub_deleted_chat_message() to service_role;
grant execute on function public.delete_chat_integration_vault_secrets() to service_role;
grant execute on function public.clear_chat_conversation(uuid) to service_role;
grant execute on function public.set_chat_integration_secret(uuid, text, text) to service_role;
grant execute on function public.get_chat_integration_secret(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 11. Documentação no catálogo (aparece no `gen types` e no psql).
-- ----------------------------------------------------------------------------
comment on column public.chat_integrations.config is
  'Configuração não secreta (ex.: apiUrl). Segredo fica no Vault, via set_chat_integration_secret.';
comment on column public.chat_integrations.token_secret_id is
  'Id no Vault do token da instância uazapi. Gravado só por set_chat_integration_secret.';
comment on column public.chat_integrations.webhook_secret_id is
  'Id no Vault do segredo do webhook (?s=). Gravado só por set_chat_integration_secret.';
comment on column public.chat_conversations.external_id is
  'Endereço do canal (dígitos do chatid, com DDI). Não é a identidade da pessoa: essa é contact_id.';
comment on column public.chat_conversations.status is
  'Dono do atendimento (bot|human|resolved). Independente do status de ticket.';
comment on column public.chat_messages.sender_type is
  'Quem escreveu: contact (entrada), agent (analista no CRM), ai (IA pela API), system, device (celular da empresa, fora do CRM).';
comment on column public.chat_messages.media_key is
  'Chave do objeto no bucket privado media_bucket. A leitura é por URL assinada curta.';

-- O PostgREST guarda o schema em cache.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
