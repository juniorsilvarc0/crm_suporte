-- ============================================================================
-- Baseline · 4/6 — contatos: a pessoa que escreve no WhatsApp, a identidade
-- telefônica dela e o vocabulário de etiquetas.
--
--   contacts                  a pessoa (raiz persistente do atendimento)
--   contact_phone_identities  telefones observados → pessoa (alias exato)
--   contact_events            trilha append-only de marcos da pessoa
--   tags                      vocabulário único de etiquetas (chat e contatos)
--   contact_tags              etiquetas do contato (N:N)
--
-- Contato é quem escreve no WhatsApp. A conversa (`chat_conversations.
-- contact_id`, em _chat) e, na Fase 4, os tickets apontam para ele. A empresa
-- (`customer_id`) chega na Fase 3; por isso a coluna nasce SEM FK.
--
-- Portado de (legado em supabase/legado-clinica/):
--   20260809110000_identidade_persistente_de_lead.sql
--     - telefone EXATO identifica a pessoa; aliases com unique global;
--     - `pg_advisory_xact_lock` por telefone normalizado no resolvedor;
--     - `match_key` do nono dígito só como chave de CANDIDATO, nunca funde;
--     - identidade primária sincronizada por trigger;
--     - eventos append-only com `event_key` idempotente.
--   projeto irmão 20260824180000_profissionalizar_dominio_leads.sql
--     - `search_name` gerado + GIN trgm; telefone imutável depois do INSERT.
--   20260101000000_core_schema.sql
--     - `tags` e `lead_tags` (→ `contact_tags`).
--
-- O que NÃO veio, de propósito:
--   - todo ramo de deal/funil/status comercial (o CRM de suporte não tem
--     oportunidade; o resolvedor perde `p_create_initial_deal` e
--     `initialDealId`);
--   - backfills: o banco nasce vazio;
--   - o que lê ou escreve `chat_conversations`/`chat_messages` mora em _chat,
--     que roda depois desta (não dá para criar trigger em tabela que ainda
--     não existe).
--
-- Segurança (AGENTS §3.1, 20260819120000_blindagem_anon.sql): RLS ligada e SEM
-- policy em todas; nada para PUBLIC/anon/authenticated; o service_role recebe
-- só os verbos que o app usa. `contacts` NÃO aceita INSERT do app: pessoa só
-- nasce pelo resolvedor, que é quem segura o lock. Nada daqui entra no
-- Realtime.
--
-- Depende de: 20260925120000_fundacao (set_updated_at, assert_security_baseline,
-- pg_trgm em `extensions`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Pré-requisitos. Falhar aqui, com o nome do que falta, é melhor que um
--    "does not exist" no meio do arquivo.
-- ----------------------------------------------------------------------------

-- No-op quando a fundação já criou. O operador é referenciado como
-- `extensions.gin_trgm_ops` (padrão da imagem supabase, onde também moram
-- pgcrypto e uuid-ossp), então a extensão PRECISA estar nesse schema.
create extension if not exists pg_trgm with schema extensions;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm'
      and n.nspname = 'extensions'
  ) then
    raise exception 'contatos: pg_trgm precisa estar no schema extensions (ver 20260925120000_fundacao)';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'contatos: public.set_updated_at() não existe; aplique 20260925120000_fundacao antes';
  end if;
  if to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'contatos: public.assert_security_baseline() não existe; aplique 20260925120000_fundacao antes';
  end if;
end
$$;

-- ============================================================================
-- 1. Normalização (precisa existir antes das tabelas: coluna gerada e check
--    dependem destas funções)
-- ============================================================================

-- Mesma regra de `src/lib/formatters/phone.ts#normalizePhone`: tira símbolos e
-- remove o DDI 55 SÓ quando sobram mais de 11 dígitos (preserva o DDD 55 do
-- RS). NÃO aplica nono dígito. Se divergir do TS, a mesma pessoa vira duas.
-- Porte literal de `normalize_lead_phone` (20260809110000:115-128). Nome
-- genérico porque a Fase 3 normaliza telefone de empresa com a mesma regra.
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) > 11
     and left(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 2) = '55'
      then substr(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 3)
    else regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  end;
$$;

-- Chave de CANDIDATO do nono dígito: celular de 11 dígitos com "9" logo após o
-- DDD vira a forma de 10 (27 9XXXX-XXXX → 27 XXXX-XXXX). Número antigo do
-- WhatsApp chega sem o 9, e a mesma pessoa aparece nas duas formas.
-- ⚠️ Nunca use para escolher nem fundir pessoa: dois números reais distintos
-- podem colidir. Serve para mostrar "possível duplicado" a um humano.
-- Porte literal de `lead_phone_match_key` (20260809110000:130-144).
create or replace function public.phone_match_key(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when length(public.normalize_phone(p_phone)) = 11
     and substr(public.normalize_phone(p_phone), 3, 1) = '9'
      then substr(public.normalize_phone(p_phone), 1, 2)
        || substr(public.normalize_phone(p_phone), 4)
    else public.normalize_phone(p_phone)
  end;
$$;

-- Texto de busca: minúsculo, sem acento, só [a-z0-9] separados por espaço.
-- Imutável porque alimenta coluna gerada. Porte de `normalize_lead_search`
-- (projeto irmão 20260824180000); nome genérico porque `customers.search_name`
-- (Fase 3) usa a mesma regra.
-- Diferença da origem: tira o acento das MAIÚSCULAS também, ANTES do `lower`.
-- Lá o `lower` vinha primeiro e só minúsculas acentuadas eram traduzidas; num
-- banco com locale C (initdb padrão, Postgres efêmero de CI) `lower('Â')`
-- continua 'Â' e "Ângela" virava "ngela". Medido; na imagem supabase (ICU)
-- não acontecia, mas a busca não deve depender do locale.
create or replace function public.normalize_search_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      lower(
        translate(
          coalesce(p_value, ''),
          'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑáàãâäéèêëíìîïóòõôöúùûüçñ',
          'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
        )
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

-- ============================================================================
-- 2. Tabelas
-- ============================================================================

-- A pessoa. `normalized_phone` é NOT NULL (na origem era nulo para quem
-- nascia fora do WhatsApp; aqui contato É a pessoa do WhatsApp, e a API cria
-- por telefone). `phone` guarda o valor cru recebido, só para exibição.
-- Mídia é privada (plano §B): o avatar é referência a objeto do Storage
-- (`avatar_bucket` + `avatar_key`), nunca URL pública.
create table if not exists public.contacts (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  phone            text not null,
  normalized_phone text not null,
  email            text,
  notes            text,
  source           text not null default 'whatsapp',
  avatar_bucket    text,
  avatar_key       text,
  customer_id      uuid,
  last_message_at  timestamptz,
  archived_at      timestamptz,
  anonymized_at    timestamptz,
  search_name      text generated always as (public.normalize_search_text(name)) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Telefones observados. `normalized_phone` é unique GLOBAL: um número aponta
-- para uma pessoa só; o telefone antigo continua como alias. Porte de
-- `lead_phone_identities` (20260809110000:42-71), sem `provider` e
-- `verified_at`, que a origem nunca preencheu.
create table if not exists public.contact_phone_identities (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null,
  normalized_phone text not null,
  match_key        text not null,
  source           text not null default 'whatsapp',
  is_primary       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Marcos da pessoa (criada, arquivada, alias novo; `conversation.*` vem de
-- _chat). Append-only: não duplica corpo de mensagem, telefone nem nada que
-- tenha tabela própria. Porte de `lead_events` (20260809110000:73-100).
create table if not exists public.contact_events (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null,
  event_type  text not null,
  entity_type text,
  entity_id   uuid,
  event_key   text,
  metadata    jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Vocabulário único: "Cliente VIP" é a mesma etiqueta no chat e no contato
-- (20260808120000_etiquetas_de_conversa.sql). `conversation_tags` fica em
-- _chat. Porte de 20260101000000_core_schema.sql:52-56.
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default 'slate',
  created_at timestamptz not null default now()
);

-- Porte de `lead_tags` (20260101000000_core_schema.sql:58-67).
create table if not exists public.contact_tags (
  contact_id uuid not null,
  tag_id     uuid not null,
  created_at timestamptz not null default now(),
  constraint contact_tags_pkey primary key (contact_id, tag_id)
);

-- Constraints nomeadas, idempotentes (só entram se ainda não existem).
do $$
declare
  c record;
begin
  for c in
    select * from (values
      -- contacts ---------------------------------------------------------------
      -- Unique NÃO parcial: dois contatos com o mesmo número é exatamente o
      -- incidente que a identidade persistente existe para impedir.
      ('contacts', 'contacts_normalized_phone_key',
       $d$unique (normalized_phone)$d$),
      ('contacts', 'contacts_normalized_phone_format_check',
       $d$check (normalized_phone ~ '^[0-9]{10,15}$')$d$),
      -- `normalized_phone` é SEMPRE derivado de `phone`: sem isto, um UPDATE
      -- de formatação poderia descolar os dois e o trigger de imutabilidade
      -- não saberia qual é o verdadeiro.
      ('contacts', 'contacts_phone_normalizes_check',
       $d$check (public.normalize_phone(phone) = normalized_phone)$d$),
      ('contacts', 'contacts_name_not_blank',
       $d$check (name is null or btrim(name) <> '')$d$),
      -- Por onde a pessoa entrou no CRM: webhook/início de conversa
      -- ('whatsapp'), cartão de contato compartilhado no chat ('indicacao'),
      -- cadastro na tela ('manual') ou API v1 ('api').
      ('contacts', 'contacts_source_check',
       $d$check (source in ('whatsapp', 'indicacao', 'manual', 'api'))$d$),
      ('contacts', 'contacts_avatar_pair_check',
       $d$check ((avatar_bucket is null) = (avatar_key is null))$d$),

      -- contact_phone_identities ----------------------------------------------
      -- `restrict`: apagar a pessoa apagaria o histórico de quem é quem.
      ('contact_phone_identities',
       'contact_phone_identities_contact_id_fkey',
       $d$foreign key (contact_id) references public.contacts (id) on delete restrict$d$),
      ('contact_phone_identities',
       'contact_phone_identities_normalized_phone_key',
       $d$unique (normalized_phone)$d$),
      ('contact_phone_identities',
       'contact_phone_identities_phone_format_check',
       $d$check (normalized_phone ~ '^[0-9]{10,15}$')$d$),
      -- A chave de candidato nunca descola do número (implica o formato).
      ('contact_phone_identities',
       'contact_phone_identities_match_key_check',
       $d$check (match_key = public.phone_match_key(normalized_phone))$d$),
      ('contact_phone_identities',
       'contact_phone_identities_source_check',
       $d$check (source in ('whatsapp', 'indicacao', 'manual', 'api'))$d$),

      -- contact_events --------------------------------------------------------
      ('contact_events', 'contact_events_contact_id_fkey',
       $d$foreign key (contact_id) references public.contacts (id) on delete restrict$d$),
      ('contact_events', 'contact_events_event_type_not_blank',
       $d$check (btrim(event_type) <> '')$d$),
      ('contact_events', 'contact_events_event_key_not_blank',
       $d$check (event_key is null or btrim(event_key) <> '')$d$),
      ('contact_events', 'contact_events_metadata_object_check',
       $d$check (jsonb_typeof(metadata) = 'object')$d$),

      -- tags ------------------------------------------------------------------
      -- O zod limita a 30; o banco só barra o absurdo.
      ('tags', 'tags_name_not_blank',
       $d$check (btrim(name) <> '' and char_length(name) <= 60)$d$),
      -- Nome de cor da paleta (`features/tags/schemas/colors.ts`), não classe
      -- CSS nem hex: a UI monta a classe a partir do nome.
      ('tags', 'tags_color_format_check',
       $d$check (color ~ '^[a-z]{3,20}$')$d$),

      -- contact_tags ----------------------------------------------------------
      -- Cascade nas duas pontas, como `lead_tags`: apagar a etiqueta
      -- (`DELETE /api/tags/[id]`) tira as atribuições junto.
      ('contact_tags', 'contact_tags_contact_id_fkey',
       $d$foreign key (contact_id) references public.contacts (id) on delete cascade$d$),
      ('contact_tags', 'contact_tags_tag_id_fkey',
       $d$foreign key (tag_id) references public.tags (id) on delete cascade$d$)
    ) as t(tbl, conname, definition)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint k
      where k.conrelid = ('public.' || quote_ident(c.tbl))::regclass
        and k.conname = c.conname
    ) then
      execute format('alter table public.%I add constraint %I %s', c.tbl, c.conname, c.definition);
    end if;
  end loop;
end
$$;

-- ============================================================================
-- 3. Índices
-- ============================================================================

-- Arquivados são minoria; o índice parcial serve à tela "arquivados".
-- Origem: `leads_archived_at_idx` (20260809110000:26-28).
create index if not exists contacts_archived_at_idx
  on public.contacts (archived_at)
  where archived_at is not null;

-- Busca por nome e por pedaço de telefone (ilike '%…%') só entre ativos.
-- Origem: projeto irmão 20260824180000.
create index if not exists contacts_active_search_name_trgm_idx
  on public.contacts using gin (search_name extensions.gin_trgm_ops)
  where archived_at is null;

create index if not exists contacts_active_normalized_phone_trgm_idx
  on public.contacts using gin (normalized_phone extensions.gin_trgm_ops)
  where archived_at is null;

-- Cursor `(updated_at, id)` e `updated_since` da API v1 (plano §C).
create index if not exists contacts_updated_at_id_idx
  on public.contacts (updated_at, id);

-- Contatos de uma empresa (Fase 3, N:1).
create index if not exists contacts_customer_id_idx
  on public.contacts (customer_id)
  where customer_id is not null;

-- No máximo UM telefone primário por pessoa (20260809110000:63-65).
create unique index if not exists contact_phone_identities_primary_contact_uidx
  on public.contact_phone_identities (contact_id)
  where is_primary;

-- Candidatos do nono dígito (20260809110000:67-68).
create index if not exists contact_phone_identities_match_key_idx
  on public.contact_phone_identities (match_key);

create index if not exists contact_phone_identities_contact_id_idx
  on public.contact_phone_identities (contact_id, created_at);

-- Unique PARCIAL de propósito: evento sem chave pode repetir (ex.: arquivar
-- duas vezes); evento com chave é idempotente via
-- `on conflict (event_key) where event_key is not null do nothing`.
-- Origem: 20260809110000:91-100.
create unique index if not exists contact_events_event_key_uidx
  on public.contact_events (event_key)
  where event_key is not null;

create index if not exists contact_events_contact_occurred_idx
  on public.contact_events (contact_id, occurred_at desc, id desc);

create index if not exists contact_events_entity_idx
  on public.contact_events (entity_type, entity_id)
  where entity_id is not null;

-- Unique por nome sem caixa nem espaço nas pontas. Sem isto, o 409 "Já existe
-- uma tag com esse nome" de `api/tags` nunca disparava na origem (a coluna
-- não tinha unique) e o vocabulário "único" aceitava "VIP" e "vip ".
create unique index if not exists tags_name_lower_uidx
  on public.tags (lower(btrim(name)));

-- Filtro por etiqueta; a PK cobre o caminho inverso.
create index if not exists contact_tags_tag_id_idx
  on public.contact_tags (tag_id);

-- ============================================================================
-- 4. RLS e privilégios de tabela
--
-- RLS ligada e NENHUMA policy: só o service_role (BYPASSRLS) e o dono (as
-- funções SECURITY DEFINER abaixo) alcançam. `revoke all` antes do grant
-- porque a imagem supabase concede ALL ao service_role por default privilege;
-- o que não estiver escrito aqui fica fechado.
-- ============================================================================

alter table public.contacts                 enable row level security;
alter table public.contact_phone_identities enable row level security;
alter table public.contact_events           enable row level security;
alter table public.tags                     enable row level security;
alter table public.contact_tags             enable row level security;

revoke all on table
  public.contacts,
  public.contact_phone_identities,
  public.contact_events,
  public.tags,
  public.contact_tags
from public, anon, authenticated, service_role;

-- contacts: sem INSERT (pessoa só nasce por `resolve_contact_identity`, que
-- segura o lock por telefone) e sem DELETE (o dia a dia arquiva). UPDATE só
-- nas colunas editáveis: `phone`/`normalized_phone` ficam de fora (telefone
-- imutável) e `last_message_at`/`source`/`anonymized_at` só mudam por
-- trigger/RPC. O trigger de imutabilidade abaixo cobre quem ignora grant.
grant select on table public.contacts to service_role;
grant update (
  name, email, notes, avatar_bucket, avatar_key, customer_id, archived_at, updated_at
) on table public.contacts to service_role;

-- Aliases só são escritos pelo resolvedor e pelo trigger de sincronização
-- (SECURITY DEFINER). O app só lê (ex.: candidatos pelo `match_key`).
grant select on table public.contact_phone_identities to service_role;

-- Append-only: nunca UPDATE/DELETE (o trigger da seção 5 barra até o dono).
grant select, insert on table public.contact_events to service_role;

grant select, insert, update, delete on table public.tags to service_role;

-- Sem UPDATE: a linha é só a chave. O upsert do supabase-js precisa de
-- `ignoreDuplicates: true` (ON CONFLICT DO NOTHING); sem ele vira DO UPDATE e
-- exige um privilégio que não faz sentido aqui.
grant select, insert, delete on table public.contact_tags to service_role;

-- ============================================================================
-- 5. Triggers
-- ============================================================================

-- updated_at em qualquer UPDATE (as rotas não mandam o campo).
drop trigger if exists trg_contacts_set_updated_at on public.contacts;
create trigger trg_contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- Telefone imutável depois do INSERT. O histórico (conversas, tickets,
-- eventos) é da pessoa desse número; trocar o número "moveria" o histórico
-- para outra pessoa. Formatação diferente do MESMO número passa.
-- Porte de `prevent_lead_phone_identity_change` (projeto irmão 20260824180000).
-- SECURITY INVOKER: não escreve nada, só recusa.
create or replace function public.prevent_contact_phone_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.normalized_phone is distinct from new.normalized_phone
     or public.normalize_phone(old.phone)
          is distinct from public.normalize_phone(new.phone) then
    raise exception 'contact_phone_is_immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contacts_prevent_phone_change on public.contacts;
create trigger trg_contacts_prevent_phone_change
  before update of phone, normalized_phone on public.contacts
  for each row execute function public.prevent_contact_phone_change();

-- O telefone da pessoa vira identidade primária exata. Se o número já é alias
-- de OUTRA pessoa, o INSERT falha com 23505 em vez de roubar a identidade.
-- Porte de `sync_lead_primary_phone_identity` (20260809110000:156-224). Com o
-- telefone imutável, na prática só roda no INSERT; o ramo de UPDATE fica
-- porque é ele que mantém a regra certa se um dia a troca for liberada.
-- Diferença da origem: não re-normaliza `new.normalized_phone` — o check
-- `contacts_phone_normalizes_check` já garante que ele é canônico.
create or replace function public.sync_contact_primary_phone_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.normalized_phone is not distinct from new.normalized_phone then
    return new;
  end if;

  -- Desmarca o primário anterior ANTES de marcar o novo: o índice único
  -- parcial `(contact_id) where is_primary` não aceita dois ao mesmo tempo.
  update public.contact_phone_identities
  set is_primary = false,
      updated_at = now()
  where contact_id = new.id
    and normalized_phone <> new.normalized_phone
    and is_primary;

  insert into public.contact_phone_identities (
    contact_id,
    normalized_phone,
    match_key,
    source,
    is_primary
  ) values (
    new.id,
    new.normalized_phone,
    public.phone_match_key(new.normalized_phone),
    new.source,
    true
  )
  on conflict (normalized_phone) do update
  set is_primary = true,
      updated_at = now()
  where public.contact_phone_identities.contact_id = excluded.contact_id
  returning id into v_identity_id;

  if v_identity_id is null then
    raise exception 'contact_phone_identity_conflict'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contacts_sync_primary_phone_identity on public.contacts;
create trigger trg_contacts_sync_primary_phone_identity
  after insert or update of normalized_phone on public.contacts
  for each row execute function public.sync_contact_primary_phone_identity();

-- Marcos da própria pessoa. `contact.created` e `contact.anonymized` têm chave
-- (acontecem uma vez); arquivar/reativar pode repetir. Porte de
-- `record_lead_row_event` (20260809110000:1153-1187), mais a anonimização,
-- cuja coluna já nasce (plano §H).
create or replace function public.record_contact_row_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.contact_events (
      contact_id, event_type, entity_type, entity_id, event_key, occurred_at
    ) values (
      new.id, 'contact.created', 'contact', new.id,
      'contact.created:' || new.id::text, new.created_at
    )
    on conflict (event_key) where event_key is not null do nothing;
    return new;
  end if;

  if old.archived_at is distinct from new.archived_at then
    insert into public.contact_events (
      contact_id, event_type, entity_type, entity_id, occurred_at
    ) values (
      new.id,
      case when new.archived_at is null then 'contact.reactivated' else 'contact.archived' end,
      'contact',
      new.id,
      now()
    );
  end if;

  if old.anonymized_at is null and new.anonymized_at is not null then
    insert into public.contact_events (
      contact_id, event_type, entity_type, entity_id, event_key, occurred_at
    ) values (
      new.id, 'contact.anonymized', 'contact', new.id,
      'contact.anonymized:' || new.id::text, new.anonymized_at
    )
    on conflict (event_key) where event_key is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contacts_record_event on public.contacts;
create trigger trg_contacts_record_event
  after insert or update of archived_at, anonymized_at on public.contacts
  for each row execute function public.record_contact_row_event();

-- Todo alias novo vira evento. Porte de `record_lead_identity_event`
-- (20260809110000:1189-1209).
create or replace function public.record_contact_identity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.contact_events (
    contact_id, event_type, entity_type, entity_id, event_key, occurred_at
  ) values (
    new.contact_id,
    'identity.added',
    'contact_phone_identity',
    new.id,
    'identity.added:' || new.id::text,
    new.created_at
  )
  on conflict (event_key) where event_key is not null do nothing;
  return new;
end;
$$;

drop trigger if exists trg_contact_phone_identities_record_event
  on public.contact_phone_identities;
create trigger trg_contact_phone_identities_record_event
  after insert on public.contact_phone_identities
  for each row execute function public.record_contact_identity_event();

-- Append-only de verdade: o grant já tira UPDATE/DELETE do service_role, mas
-- função SECURITY DEFINER roda como dono e passaria. História reescrita em
-- silêncio é pior que erro. Novo em relação à origem, que só tinha o grant.
create or replace function public.prevent_contact_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'contact_events_is_append_only'
    using errcode = '0A000';
end;
$$;

drop trigger if exists trg_contact_events_append_only on public.contact_events;
create trigger trg_contact_events_append_only
  before update or delete on public.contact_events
  for each row execute function public.prevent_contact_event_mutation();

-- ============================================================================
-- 6. Resolvedor de identidade — fonte ÚNICA de criação de contato
--
-- Porte de `resolve_lead_identity`, última definição em
-- 20260809110000:286-431 (20260809111000 só a chama). Invariantes mantidos:
--   - advisory lock transacional por telefone normalizado: dois webhooks do
--     mesmo número ao mesmo tempo resolvem para UMA pessoa;
--   - igualdade EXATA vence; `match_key` nunca seleciona nem funde;
--   - alias com unique global; alias de outra pessoa → 23505;
--   - nome só preenche vazio (o do provedor nunca sobrescreve o editado);
--   - `last_message_at` só avança (greatest).
-- Removido: `p_create_initial_deal`, o ramo que cria deal, `initialDealId` e
-- o `app.skip_initial_deal` (não há deal). `phone = coalesce(phone, p_phone)`
-- saiu porque `phone` é NOT NULL e imutável.
--
-- Chamadores: webhook uazapi (inbound e fromMe), início de conversa, contato
-- compartilhado no chat e, na Fase 5, `POST /api/v1/contacts`.
-- ============================================================================
create or replace function public.resolve_contact_identity(
  p_phone text,
  p_name text default null,
  p_source text default 'whatsapp',
  p_last_interaction_at timestamptz default null,
  p_reactivate boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized text;
  v_source text := coalesce(nullif(btrim(p_source), ''), 'whatsapp');
  v_contact_id uuid;
  v_created boolean := false;
begin
  v_normalized := public.normalize_phone(p_phone);
  if v_normalized is null or v_normalized !~ '^[0-9]{10,15}$' then
    raise exception 'invalid_normalized_phone'
      using errcode = '22023';
  end if;

  -- Serializa só quem disputa o MESMO número; números diferentes não esperam.
  -- A unique do alias cobre qualquer caminho que escape do lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_normalized, 0)
  );

  select i.contact_id
    into v_contact_id
  from public.contact_phone_identities i
  where i.normalized_phone = v_normalized;

  -- Rede de segurança da origem (lá era compatibilidade de rollout): pessoa
  -- com o número mas sem alias. Com o trigger de sincronização e sem DELETE
  -- no alias não deveria acontecer; custa um índice único.
  if v_contact_id is null then
    select c.id
      into v_contact_id
    from public.contacts c
    where c.normalized_phone = v_normalized;
  end if;

  if v_contact_id is null then
    insert into public.contacts (
      phone,
      normalized_phone,
      name,
      source,
      last_message_at,
      archived_at,
      updated_at
    ) values (
      p_phone,
      v_normalized,
      nullif(btrim(p_name), ''),
      v_source,
      p_last_interaction_at,
      null,
      now()
    )
    returning id into v_contact_id;

    v_created := true;
  else
    update public.contacts
    set name = case
          when name is null then nullif(btrim(p_name), '')
          else name
        end,
        last_message_at = case
          when p_last_interaction_at is null then last_message_at
          else greatest(coalesce(last_message_at, p_last_interaction_at), p_last_interaction_at)
        end,
        archived_at = case when p_reactivate then null else archived_at end,
        updated_at = now()
    where id = v_contact_id;
  end if;

  -- Registra o número observado como alias da pessoa resolvida. Na criação o
  -- trigger já gravou o primário e isto só toca `updated_at`.
  insert into public.contact_phone_identities (
    contact_id,
    normalized_phone,
    match_key,
    source,
    is_primary
  ) values (
    v_contact_id,
    v_normalized,
    public.phone_match_key(v_normalized),
    v_source,
    v_created
  )
  on conflict (normalized_phone) do update
  set updated_at = now()
  where public.contact_phone_identities.contact_id = excluded.contact_id;

  if not exists (
    select 1
    from public.contact_phone_identities i
    where i.normalized_phone = v_normalized
      and i.contact_id = v_contact_id
  ) then
    raise exception 'contact_phone_identity_conflict'
      using errcode = '23505';
  end if;

  return jsonb_build_object(
    'contactId', v_contact_id,
    'normalizedPhone', v_normalized,
    'created', v_created
  );
end;
$$;

-- ============================================================================
-- 7. Privilégios de função
--
-- No Postgres a função nasce com EXECUTE para PUBLIC, e `anon` herda dali:
-- revogar só de `anon` não fecha nada (20260819120000_blindagem_anon.sql,
-- erro (a)). O service_role precisa de EXECUTE nas de normalização porque o
-- check e a coluna gerada de `contacts` as avaliam como QUEM ATUALIZA a linha.
-- ============================================================================

revoke execute on function public.normalize_phone(text) from public, anon, authenticated;
revoke execute on function public.phone_match_key(text) from public, anon, authenticated;
revoke execute on function public.normalize_search_text(text) from public, anon, authenticated;
revoke execute on function public.prevent_contact_phone_change() from public, anon, authenticated;
revoke execute on function public.sync_contact_primary_phone_identity() from public, anon, authenticated;
revoke execute on function public.record_contact_row_event() from public, anon, authenticated;
revoke execute on function public.record_contact_identity_event() from public, anon, authenticated;
revoke execute on function public.prevent_contact_event_mutation() from public, anon, authenticated;
revoke execute on function public.resolve_contact_identity(text, text, text, timestamptz, boolean)
  from public, anon, authenticated;

grant execute on function public.normalize_phone(text) to service_role;
grant execute on function public.phone_match_key(text) to service_role;
grant execute on function public.normalize_search_text(text) to service_role;
grant execute on function public.prevent_contact_phone_change() to service_role;
grant execute on function public.sync_contact_primary_phone_identity() to service_role;
grant execute on function public.record_contact_row_event() to service_role;
grant execute on function public.record_contact_identity_event() to service_role;
grant execute on function public.prevent_contact_event_mutation() to service_role;
grant execute on function public.resolve_contact_identity(text, text, text, timestamptz, boolean)
  to service_role;

-- ============================================================================
-- 8. Documentação no catálogo
-- ============================================================================

comment on table public.contacts is
  'Pessoa que escreve no WhatsApp. Nasce só por resolve_contact_identity; telefone imutável; acesso só pelo servidor.';
comment on column public.contacts.normalized_phone is
  'Identidade exata (regra de src/lib/formatters/phone.ts). Imutável depois do INSERT.';
comment on column public.contacts.search_name is
  'Nome normalizado (sem acento/caixa) para busca por trigram entre contatos ativos.';
comment on column public.contacts.customer_id is
  'Empresa do contato. A FK para customers entra na Fase 3.';
comment on column public.contacts.anonymized_at is
  'Marca de anonimização (LGPD). O fluxo fica fora da v1; a coluna já nasce.';
comment on table public.contact_phone_identities is
  'Telefones observados → contato. Unique global por número; match_key só sugere candidato, nunca funde.';
comment on table public.contact_events is
  'Marcos do contato, append-only. event_key não nulo é idempotente.';
comment on table public.tags is
  'Vocabulário único de etiquetas (chat e contatos). Nome único sem caixa.';
comment on function public.resolve_contact_identity(text, text, text, timestamptz, boolean) is
  'Única porta de criação de contato: lock por telefone, igualdade exata, alias idempotente. Retorna {contactId, normalizedPhone, created}.';
comment on function public.phone_match_key(text) is
  'Chave de candidato do nono dígito. Nunca use para escolher ou fundir contato.';

-- O PostgREST guarda o schema em cache.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
