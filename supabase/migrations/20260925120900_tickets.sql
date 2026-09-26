-- ============================================================================
-- Fase 4 · Tickets — máquina de estados, SLA e o ticket em foco da conversa.
--
--   ticket_statuses            8 status FIXOS (decisão 11): o admin edita rótulo e
--                              cor; sla_mode, is_terminal e posição são do sistema.
--   ticket_status_transitions  a matriz. Só leitura; muda por migration (converge).
--   sla_policies               minutos por prioridade; valem para ticket NOVO
--                              (o ticket guarda snapshot).
--   ticket_categories          categoria (2 níveis), opcionalmente de uma fila.
--   tickets                    o chamado. Escrito SÓ pelas RPCs deste arquivo.
--   ticket_status_history      toda mudança de status (append-only; métricas F9).
--   ticket_events              os demais marcos (append-only; event_key idempotente).
--   ticket_comments            nota interna do ticket (fora do chat).
--   ticket_attachments         anexo no bucket PRIVADO ticket-attachments.
--   chat_conversations.active_ticket_id   ticket em foco da conversa.
--   chat_messages.ticket_id               carimbado no INSERT com o foco.
--   ticket_queue               view de leitura: SLA calculado com now().
--
-- Invariantes que moram AQUI (a UI agora e a API v1 da Fase 5 passam por elas):
--   1. Status só anda pela matriz (plano A.3). Fora dela: INVALID_TRANSITION com
--      os destinos permitidos no DETAIL (jsonb). guard_ticket_update barra
--      qualquer outro escritor, até o dono. Sem "force".
--   2. service_role só LÊ tickets e a trilha. Escrita = RPC SECURITY DEFINER que
--      confere o ator no banco (usuário ativo ou token vigente).
--   3. Concorrência otimista: version sobe só em coluna de negócio; destino
--      igual ao atual é no-op ANTES de conferir a versão (retry seguro).
--   4. Aritmética do SLA é CHECK. 1ª resposta = abertura + minutos (não pausa).
--      Solução = abertura + minutos + segundos parados. Relógio de solução
--      parado ⇔ status fora de running (pausa E parada: reabrir retoma o resto).
--   5. Mensagem nasce no ticket em foco (o valor mandado pelo app é ignorado).
--      Foco e mensagem só apontam para ticket da MESMA conversa (FK composta).
--      Ticket terminal sai do foco.
--   6. 1ª resposta = mensagem agent, não nota, aceita pelo provedor
--      (sent|delivered|read). A da IA fica em first_ai_response_at.
--   7. Travas: conversa ANTES do ticket, sempre. A mensagem pega FOR KEY SHARE
--      na conversa (o mesmo modo que a FK dela já pega); quem muda o foco pega
--      FOR UPDATE; o ticket só é travado FOR NO KEY UPDATE.
--   8. Conversa com ticket não se limpa (clear) nem se apaga (FK restrict).
--
-- Segurança (AGENTS §3.1): RLS ligada e SEM policy; nada para PUBLIC/anon/
-- authenticated; nada entra na publication. active_ticket_id e ticket_id saem
-- no Realtime do chat (SELECT de tabela de authenticated): são só uuids, e
-- nenhum dado de ticket é desnormalizado em chat_*.
--
-- Fora daqui, de propósito: ticket_tags (sem tela), escrita de *_breached_at
-- (Fase 6, sla_sweep), Realtime de tickets (aprovação pendente no plano).
--
-- Depende de 20260925120000..20260925120800. Exige PostgreSQL 15+.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Pré-requisitos
-- ----------------------------------------------------------------------------
do $$
begin
  if pg_catalog.current_setting('server_version_num')::integer < 150000 then
    raise exception 'TICKETS: exige PostgreSQL 15+ (on delete set null (coluna), nulls not distinct)';
  end if;
  if to_regprocedure('public.assert_security_baseline()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'TICKETS: aplique 20260925120000_fundacao antes';
  end if;
  if to_regclass('public.app_users') is null then
    raise exception 'TICKETS: aplique 20260925120100_usuarios antes';
  end if;
  if to_regclass('public.api_tokens') is null then
    raise exception 'TICKETS: aplique 20260925120200_integracao antes';
  end if;
  if to_regclass('public.contacts') is null
     or to_regprocedure('public.normalize_search_text(text)') is null then
    raise exception 'TICKETS: aplique 20260925120300_contatos antes';
  end if;
  if to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or to_regprocedure('public.clear_chat_conversation(uuid)') is null
     or to_regprocedure('public.increment_unread_from_inserted_message()') is null then
    raise exception 'TICKETS: aplique 20260925120400_chat antes';
  end if;
  if to_regclass('public.products') is null
     or to_regclass('public.customers') is null
     or to_regclass('public.support_contracts') is null then
    raise exception 'TICKETS: aplique 20260925120700_cadastros antes';
  end if;
end
$$;

-- ============================================================================
-- 1. Catálogos
-- ============================================================================

-- 1.1 Status. sla_mode/is_terminal estão repetidos, de propósito, nos CHECKs de
-- tickets; a asserção §14 confere que os dois lados batem.
create table if not exists public.ticket_statuses (
  key         text primary key,
  label       text not null,
  color       text not null,
  position    smallint not null,
  sla_mode    text not null,
  is_terminal boolean not null,
  updated_at  timestamptz not null default now(),
  constraint ticket_statuses_key_check check (key in (
    'novo', 'em_triagem', 'em_atendimento', 'aguardando_cliente',
    'aguardando_interno', 'resolvido', 'fechado', 'cancelado'
  )),
  constraint ticket_statuses_label_check check (btrim(label) <> '' and char_length(label) <= 40),
  -- Nome da paleta (features/tags/schemas/colors.ts); o zod confere a lista.
  constraint ticket_statuses_color_check check (color ~ '^[a-z]{3,20}$'),
  constraint ticket_statuses_position_check check (position between 1 and 99),
  constraint ticket_statuses_sla_mode_check check (sla_mode in ('running', 'paused', 'stopped')),
  constraint ticket_statuses_terminal_check check (not is_terminal or sla_mode = 'stopped')
);

create unique index if not exists ticket_statuses_label_uidx
  on public.ticket_statuses (lower(btrim(label)));

-- label e color ficam FORA do do update: são do admin, e reaplicar não desfaz.
insert into public.ticket_statuses as s (key, label, color, position, sla_mode, is_terminal) values
  ('novo',               'Novo',               'sky',     10, 'running', false),
  ('em_triagem',         'Em triagem',         'violet',  20, 'running', false),
  ('em_atendimento',     'Em atendimento',     'blue',    30, 'running', false),
  ('aguardando_cliente', 'Aguardando cliente', 'amber',   40, 'paused',  false),
  ('aguardando_interno', 'Aguardando interno', 'orange',  50, 'running', false),
  ('resolvido',          'Resolvido',          'emerald', 60, 'stopped', false),
  ('fechado',            'Fechado',            'slate',   70, 'stopped', true),
  ('cancelado',          'Cancelado',          'gray',    80, 'stopped', true)
on conflict (key) do update
  set position    = excluded.position,
      sla_mode    = excluded.sla_mode,
      is_terminal = excluded.is_terminal
  where (s.position, s.sla_mode, s.is_terminal)
        is distinct from (excluded.position, excluded.sla_mode, excluded.is_terminal);

-- 1.2 Matriz (pergunta Q1 ao dono). Converge: o par que não está aqui sai.
create table if not exists public.ticket_status_transitions (
  from_status text not null,
  to_status   text not null,
  constraint ticket_status_transitions_pkey primary key (from_status, to_status),
  constraint ticket_status_transitions_from_fkey
    foreign key (from_status) references public.ticket_statuses (key) on delete restrict,
  constraint ticket_status_transitions_to_fkey
    foreign key (to_status) references public.ticket_statuses (key) on delete restrict,
  constraint ticket_status_transitions_not_self check (from_status <> to_status)
);

do $$
declare
  v_matrix constant jsonb := '[
    ["novo","em_triagem"], ["novo","em_atendimento"], ["novo","aguardando_cliente"],
    ["novo","aguardando_interno"], ["novo","cancelado"],
    ["em_triagem","em_atendimento"], ["em_triagem","aguardando_cliente"],
    ["em_triagem","aguardando_interno"], ["em_triagem","cancelado"],
    ["em_atendimento","aguardando_cliente"], ["em_atendimento","aguardando_interno"],
    ["em_atendimento","resolvido"], ["em_atendimento","cancelado"],
    ["aguardando_cliente","em_atendimento"], ["aguardando_cliente","aguardando_interno"],
    ["aguardando_cliente","resolvido"], ["aguardando_cliente","cancelado"],
    ["aguardando_interno","em_atendimento"], ["aguardando_interno","aguardando_cliente"],
    ["aguardando_interno","resolvido"], ["aguardando_interno","cancelado"],
    ["resolvido","em_atendimento"], ["resolvido","fechado"]
  ]';
begin
  delete from public.ticket_status_transitions t
   where not exists (
     select 1 from pg_catalog.jsonb_array_elements(v_matrix) e
      where e ->> 0 = t.from_status and e ->> 1 = t.to_status
   );
  insert into public.ticket_status_transitions (from_status, to_status)
  select e ->> 0, e ->> 1 from pg_catalog.jsonb_array_elements(v_matrix) e
  on conflict do nothing;
end
$$;

-- 1.3 SLA por prioridade (decisão 3; valores de "Decisões que tomei").
create table if not exists public.sla_policies (
  priority               text primary key,
  rank                   smallint not null,
  first_response_minutes integer not null,
  resolution_minutes     integer not null,
  warn_pct               smallint not null default 80,
  updated_at             timestamptz not null default now(),
  constraint sla_policies_priority_check check (priority in ('baixa', 'media', 'alta', 'critica')),
  constraint sla_policies_rank_key unique (rank),
  constraint sla_policies_first_response_check check (first_response_minutes between 1 and 525600),
  constraint sla_policies_resolution_check check (resolution_minutes between 1 and 525600),
  constraint sla_policies_order_check check (first_response_minutes <= resolution_minutes),
  constraint sla_policies_warn_pct_check check (warn_pct between 1 and 99)
);

-- Minutos e warn_pct são do admin: o do update só converge o rank.
insert into public.sla_policies as p (priority, rank, first_response_minutes, resolution_minutes, warn_pct) values
  ('baixa',   1, 480, 4320, 80),
  ('media',   2, 240, 1440, 80),
  ('alta',    3,  60,  480, 80),
  ('critica', 4,  30,  240, 80)
on conflict (priority) do update set rank = excluded.rank
  where p.rank is distinct from excluded.rank;

-- 1.4 Categorias. product_id e parent_id não mudam depois do INSERT (grant).
create table if not exists public.ticket_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  product_id  uuid,
  parent_id   uuid,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ticket_categories_product_id_fkey
    foreign key (product_id) references public.products (id) on delete restrict,
  constraint ticket_categories_parent_id_fkey
    foreign key (parent_id) references public.ticket_categories (id) on delete restrict,
  constraint ticket_categories_name_check check (btrim(name) <> '' and char_length(name) <= 80),
  constraint ticket_categories_not_own_parent check (parent_id is null or parent_id <> id)
);

create unique index if not exists ticket_categories_name_active_uidx
  on public.ticket_categories (product_id, parent_id, lower(btrim(name))) nulls not distinct
  where archived_at is null;

-- ============================================================================
-- 2. tickets
-- ============================================================================
create table if not exists public.tickets (
  id                          uuid primary key default gen_random_uuid(),
  -- Protocolo: <site.ticketPrefix>-<number> (SUP-1000).
  number                      bigint generated always as identity (start with 1000),
  title                       text not null,
  description                 text,
  status                      text not null default 'novo',
  priority                    text not null,
  conversation_id             uuid not null,
  contact_id                  uuid not null,
  customer_id                 uuid,
  contract_id                 uuid,
  product_id                  uuid,
  category_id                 uuid,
  assigned_to_user_id         uuid,
  source                      text not null,
  created_by_user_id          uuid,
  created_by_token_id         uuid,
  idempotency_key             text,
  external_id                 text,
  ai_triage                   jsonb,
  sla_first_response_minutes  integer not null,
  sla_resolution_minutes      integer not null,
  sla_warn_pct                smallint not null,
  first_response_due_at       timestamptz not null,
  resolution_due_at           timestamptz not null,
  first_responded_at          timestamptz,
  first_ai_response_at        timestamptz,
  -- Carimbados pelo sla_sweep da Fase 6. Nada escreve neles na Fase 4; a tela
  -- não depende deles (SLA calculado na leitura, plano A.6).
  first_response_breached_at  timestamptz,
  resolution_breached_at      timestamptz,
  sla_paused_at               timestamptz,
  sla_paused_seconds          integer not null default 0,
  resolved_at                 timestamptz,
  closed_at                   timestamptz,
  reopened_count              integer not null default 0,
  version                     integer not null default 1,
  search_title                text generated always as (public.normalize_search_text(title)) stored,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint tickets_status_fkey
    foreign key (status) references public.ticket_statuses (key) on delete restrict,
  constraint tickets_priority_fkey
    foreign key (priority) references public.sla_policies (priority) on delete restrict,
  constraint tickets_conversation_id_fkey
    foreign key (conversation_id) references public.chat_conversations (id) on delete restrict,
  constraint tickets_contact_id_fkey
    foreign key (contact_id) references public.contacts (id) on delete restrict,
  constraint tickets_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete restrict,
  constraint tickets_contract_id_fkey
    foreign key (contract_id) references public.support_contracts (id) on delete restrict,
  constraint tickets_product_id_fkey
    foreign key (product_id) references public.products (id) on delete restrict,
  constraint tickets_category_id_fkey
    foreign key (category_id) references public.ticket_categories (id) on delete restrict,
  constraint tickets_assigned_to_user_id_fkey
    foreign key (assigned_to_user_id) references public.app_users (id) on delete set null,
  constraint tickets_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint tickets_created_by_token_id_fkey
    foreign key (created_by_token_id) references public.api_tokens (id) on delete restrict,

  constraint tickets_number_key unique (number),
  -- Alvo das FKs compostas de chat_messages e chat_conversations (§4).
  constraint tickets_id_conversation_key unique (id, conversation_id),
  -- Idempotência POR ATOR (único não parcial, plano §B): a chave de um
  -- integrador nunca acha o ticket de outro.
  constraint tickets_user_idempotency_key unique (created_by_user_id, idempotency_key),
  constraint tickets_token_idempotency_key unique (created_by_token_id, idempotency_key),
  constraint tickets_token_external_id_key unique (created_by_token_id, external_id),

  constraint tickets_title_check check (btrim(title) <> '' and char_length(title) <= 200),
  constraint tickets_description_check
    check (description is null or (btrim(description) <> '' and char_length(description) <= 10000)),
  constraint tickets_source_check check (source in ('ai', 'agent', 'api')),
  -- Tela = usuário (vira null se ele for excluído); integração = token (nunca apagado).
  constraint tickets_creator_check check (
    (source = 'agent' and created_by_token_id is null)
    or (source in ('ai', 'api') and created_by_user_id is null and created_by_token_id is not null)
  ),
  constraint tickets_idempotency_key_check
    check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  constraint tickets_external_id_check check (
    external_id is null
    or (source in ('ai', 'api') and btrim(external_id) <> '' and char_length(external_id) <= 200)
  ),
  constraint tickets_ai_triage_check check (
    ai_triage is null
    or (jsonb_typeof(ai_triage) = 'object' and octet_length(ai_triage::text) <= 16384)
  ),
  constraint tickets_sla_snapshot_check check (
    sla_first_response_minutes between 1 and 525600
    and sla_resolution_minutes between 1 and 525600
    and sla_warn_pct between 1 and 99
  ),
  -- Invariante 4: a aritmética do SLA. Nenhum escritor desalinha prazo e snapshot.
  constraint tickets_first_response_due_check check (
    extract(epoch from (first_response_due_at - created_at)) = sla_first_response_minutes * 60
  ),
  constraint tickets_resolution_due_check check (
    extract(epoch from (resolution_due_at - created_at))
      = sla_resolution_minutes * 60 + sla_paused_seconds
  ),
  -- Relógio de solução parado ⇔ status não running. Lista = ticket_statuses (§14).
  constraint tickets_sla_clock_check check (
    (sla_paused_at is null)
      = (status in ('novo', 'em_triagem', 'em_atendimento', 'aguardando_interno'))
  ),
  constraint tickets_resolved_at_check check (
    (resolved_at is not null) = (status in ('resolvido', 'fechado'))
  ),
  constraint tickets_closed_at_check check (
    (closed_at is not null) = (status in ('fechado', 'cancelado'))
  ),
  constraint tickets_stamps_after_open_check check (
    (first_responded_at is null or first_responded_at >= created_at)
    and (first_ai_response_at is null or first_ai_response_at >= created_at)
    and (resolved_at is null or resolved_at >= created_at)
    and (closed_at is null or closed_at >= created_at)
  ),
  constraint tickets_counters_check check (
    sla_paused_seconds >= 0 and reopened_count >= 0 and version >= 1
  )
);

-- ============================================================================
-- 3. Satélites
-- ============================================================================

-- Ordem da trilha. Uma RPC grava várias linhas na MESMA transação, todas com o
-- mesmo occurred_at (v_now: as métricas comparam com os carimbos do ticket), e o
-- id é aleatório. Sem isto a timeline mostraria "novo → em atendimento" antes de
-- "aberto". Uma sequência só para history E events: a ordem vale entre as duas.
-- Achado da corrida R2 (PROGRESS 2026-09-25).
create sequence if not exists public.ticket_log_seq;

-- Ator SEM FK de propósito: delete_app_user apaga o usuário de verdade, e uma
-- FK set null reescreveria a trilha append-only. A tela mostra "Usuário removido".
create table if not exists public.ticket_status_history (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null,
  from_status    text,
  to_status      text not null,
  actor_type     text not null,
  actor_user_id  uuid,
  actor_token_id uuid,
  reason         text,
  occurred_at    timestamptz not null default now(),
  constraint ticket_status_history_ticket_id_fkey
    foreign key (ticket_id) references public.tickets (id) on delete restrict,
  constraint ticket_status_history_from_fkey
    foreign key (from_status) references public.ticket_statuses (key) on delete restrict,
  constraint ticket_status_history_to_fkey
    foreign key (to_status) references public.ticket_statuses (key) on delete restrict,
  constraint ticket_status_history_change_check check (from_status is distinct from to_status),
  constraint ticket_status_history_actor_check check (
    (actor_type = 'agent' and actor_user_id is not null and actor_token_id is null)
    or (actor_type in ('ai', 'api') and actor_token_id is not null and actor_user_id is null)
    or (actor_type = 'system' and actor_user_id is null and actor_token_id is null)
  ),
  constraint ticket_status_history_reason_check
    check (reason is null or (btrim(reason) <> '' and char_length(reason) <= 500)),
  seq            bigint not null default nextval('public.ticket_log_seq')
);

create table if not exists public.ticket_events (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null,
  event_type     text not null,
  actor_type     text not null,
  actor_user_id  uuid,
  actor_token_id uuid,
  metadata       jsonb not null default '{}'::jsonb,
  event_key      text,
  occurred_at    timestamptz not null default now(),
  constraint ticket_events_ticket_id_fkey
    foreign key (ticket_id) references public.tickets (id) on delete restrict,
  -- Padrão, não lista: a Fase 6 acrescenta tipos sem migration.
  constraint ticket_events_type_check check (event_type ~ '^ticket\.[a-z_]{3,40}$'),
  constraint ticket_events_actor_check check (
    (actor_type = 'agent' and actor_user_id is not null and actor_token_id is null)
    or (actor_type in ('ai', 'api') and actor_token_id is not null and actor_user_id is null)
    or (actor_type = 'system' and actor_user_id is null and actor_token_id is null)
  ),
  constraint ticket_events_event_key_check check (event_key is null or btrim(event_key) <> ''),
  constraint ticket_events_metadata_check check (jsonb_typeof(metadata) = 'object'),
  seq            bigint not null default nextval('public.ticket_log_seq')
);

create table if not exists public.ticket_comments (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null,
  author_user_id  uuid,
  author_token_id uuid,
  body            text,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  constraint ticket_comments_ticket_id_fkey
    foreign key (ticket_id) references public.tickets (id) on delete restrict,
  constraint ticket_comments_author_user_id_fkey
    foreign key (author_user_id) references public.app_users (id) on delete set null,
  constraint ticket_comments_author_token_id_fkey
    foreign key (author_token_id) references public.api_tokens (id) on delete restrict,
  constraint ticket_comments_one_author check (num_nonnulls(author_user_id, author_token_id) <= 1),
  -- Apagado não guarda texto, em nenhum caminho.
  constraint ticket_comments_body_check check (
    (deleted_at is null) = (body is not null)
    and (body is null or (btrim(body) <> '' and char_length(body) <= 5000))
  )
);

create table if not exists public.ticket_attachments (
  id                   uuid primary key default gen_random_uuid(),
  ticket_id            uuid not null,
  bucket               text not null default 'ticket-attachments',
  object_key           text not null,
  file_name            text not null,
  mime                 text not null,
  size_bytes           bigint not null,
  sha256               text not null,
  uploaded_by_user_id  uuid,
  uploaded_by_token_id uuid,
  created_at           timestamptz not null default now(),
  constraint ticket_attachments_ticket_id_fkey
    foreign key (ticket_id) references public.tickets (id) on delete restrict,
  constraint ticket_attachments_uploaded_by_user_id_fkey
    foreign key (uploaded_by_user_id) references public.app_users (id) on delete set null,
  constraint ticket_attachments_uploaded_by_token_id_fkey
    foreign key (uploaded_by_token_id) references public.api_tokens (id) on delete restrict,
  constraint ticket_attachments_object_key_key unique (object_key),
  constraint ticket_attachments_bucket_check check (bucket = 'ticket-attachments'),
  -- Chave tickets/<ticket_id>/<uuid>, nunca o nome do arquivo, e DESTE ticket.
  constraint ticket_attachments_object_key_check check (
    object_key ~ '^tickets/[0-9a-f-]{36}/[0-9a-f-]{36}$'
    and starts_with(object_key, 'tickets/' || ticket_id::text || '/')
  ),
  constraint ticket_attachments_file_name_check
    check (btrim(file_name) <> '' and char_length(file_name) <= 255 and file_name !~ '[/\\]'),
  constraint ticket_attachments_mime_check
    check (mime ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' and char_length(mime) <= 127),
  constraint ticket_attachments_size_check check (size_bytes between 1 and 52428800),
  constraint ticket_attachments_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint ticket_attachments_one_uploader
    check (num_nonnulls(uploaded_by_user_id, uploaded_by_token_id) <= 1)
);

-- ============================================================================
-- 4. Chat: foco e carimbo
-- ============================================================================
alter table public.chat_conversations add column if not exists active_ticket_id uuid;
alter table public.chat_messages      add column if not exists ticket_id uuid;

do $$
begin
  -- Foco só aponta para ticket DESTA conversa. set null só na coluna do foco
  -- (PG15+); sem a lista, zeraria também o id.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.chat_conversations'::regclass
       and conname = 'chat_conversations_active_ticket_fkey'
  ) then
    alter table public.chat_conversations
      add constraint chat_conversations_active_ticket_fkey
      foreign key (active_ticket_id, id) references public.tickets (id, conversation_id)
      on delete set null (active_ticket_id);
  end if;

  -- Mensagem só cai em ticket da própria conversa, para qualquer escritor.
  -- MATCH SIMPLE: ticket_id nulo não confere nada.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.chat_messages'::regclass
       and conname = 'chat_messages_ticket_fkey'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_ticket_fkey
      foreign key (ticket_id, conversation_id) references public.tickets (id, conversation_id)
      on delete restrict;
  end if;
end
$$;

-- ============================================================================
-- 5. Índices
-- ============================================================================
create index if not exists tickets_conversation_idx
  on public.tickets (conversation_id, created_at desc);
create index if not exists tickets_status_idx
  on public.tickets (status, created_at desc);
create index if not exists tickets_assignee_status_idx
  on public.tickets (assigned_to_user_id, status);
create index if not exists tickets_open_resolution_due_idx
  on public.tickets (resolution_due_at) where closed_at is null;
create index if not exists tickets_open_first_response_due_idx
  on public.tickets (first_response_due_at) where first_responded_at is null and closed_at is null;
create index if not exists tickets_customer_idx
  on public.tickets (customer_id, created_at desc) where customer_id is not null;
create index if not exists tickets_contact_idx
  on public.tickets (contact_id, created_at desc);
create index if not exists tickets_product_idx
  on public.tickets (product_id) where product_id is not null;
create index if not exists tickets_category_idx
  on public.tickets (category_id) where category_id is not null;
create index if not exists tickets_contract_idx
  on public.tickets (contract_id) where contract_id is not null;
create index if not exists tickets_created_by_user_idx
  on public.tickets (created_by_user_id) where created_by_user_id is not null;
-- Cursor (updated_at, id) e updated_since da API v1.
create index if not exists tickets_updated_at_id_idx
  on public.tickets (updated_at, id);
create index if not exists tickets_search_title_trgm_idx
  on public.tickets using gin (search_title extensions.gin_trgm_ops);

create index if not exists chat_messages_ticket_idx
  on public.chat_messages (ticket_id, created_at desc, id desc) where ticket_id is not null;
create index if not exists chat_conversations_active_ticket_idx
  on public.chat_conversations (active_ticket_id) where active_ticket_id is not null;

create index if not exists ticket_status_history_ticket_idx
  on public.ticket_status_history (ticket_id, occurred_at desc, seq desc);
create index if not exists ticket_events_ticket_idx
  on public.ticket_events (ticket_id, occurred_at desc, seq desc);
create unique index if not exists ticket_events_event_key_uidx
  on public.ticket_events (event_key) where event_key is not null;
create index if not exists ticket_comments_ticket_idx
  on public.ticket_comments (ticket_id, created_at desc, id desc);
create index if not exists ticket_comments_author_user_idx
  on public.ticket_comments (author_user_id) where author_user_id is not null;
create index if not exists ticket_attachments_ticket_idx
  on public.ticket_attachments (ticket_id, created_at desc, id desc);
create index if not exists ticket_attachments_uploader_idx
  on public.ticket_attachments (uploaded_by_user_id) where uploaded_by_user_id is not null;
create index if not exists ticket_categories_product_idx
  on public.ticket_categories (product_id) where product_id is not null;
create index if not exists ticket_categories_parent_idx
  on public.ticket_categories (parent_id) where parent_id is not null;

-- ============================================================================
-- 6. RLS e privilégios de tabela (RLS ligada, NENHUMA policy)
-- ============================================================================
alter table public.ticket_statuses           enable row level security;
alter table public.ticket_status_transitions enable row level security;
alter table public.sla_policies              enable row level security;
alter table public.ticket_categories         enable row level security;
alter table public.tickets                   enable row level security;
alter table public.ticket_status_history     enable row level security;
alter table public.ticket_events             enable row level security;
alter table public.ticket_comments           enable row level security;
alter table public.ticket_attachments        enable row level security;

revoke all on table
  public.ticket_statuses, public.ticket_status_transitions, public.sla_policies,
  public.ticket_categories, public.tickets, public.ticket_status_history,
  public.ticket_events, public.ticket_comments, public.ticket_attachments
from public, anon, authenticated, service_role;

-- Catálogos (4f, admin conferido na rota).
grant select on table public.ticket_statuses to service_role;
grant update (label, color, updated_at) on table public.ticket_statuses to service_role;
grant select on table public.ticket_status_transitions to service_role;
grant select on table public.sla_policies to service_role;
grant update (first_response_minutes, resolution_minutes, warn_pct, updated_at)
  on table public.sla_policies to service_role;
grant select on table public.ticket_categories to service_role;
grant insert (name, product_id, parent_id) on table public.ticket_categories to service_role;
grant update (name, archived_at, updated_at) on table public.ticket_categories to service_role;

-- Invariante 2: ticket e trilha só por RPC.
grant select on table public.tickets to service_role;
grant select on table public.ticket_status_history, public.ticket_events to service_role;

-- Comentário e anexo: grant por coluna; autor conferido na rota (par de note-actions).
grant select on table public.ticket_comments to service_role;
grant insert (ticket_id, author_user_id, author_token_id, body)
  on table public.ticket_comments to service_role;
grant update (body, deleted_at) on table public.ticket_comments to service_role;
grant select on table public.ticket_attachments to service_role;
grant insert (ticket_id, bucket, object_key, file_name, mime, size_bytes, sha256,
              uploaded_by_user_id, uploaded_by_token_id)
  on table public.ticket_attachments to service_role;

-- 4f (adiado da Fase 3): renomear, nicho, cor, arquivar e reativar fila.
-- SEM `revoke all on products`: apagaria os grants de _cadastros.
grant update (name, niche, color, archived_at, updated_at) on table public.products to service_role;

-- ============================================================================
-- 7. Helpers internos (sem EXECUTE para ninguém; só as RPCs, como dono, chamam)
-- ============================================================================

-- 7.1 Exatamente um ator: usuário ATIVO (qualquer papel) ou token vigente.
-- É a 1ª instrução de toda RPC de ticket, e pega (compartilhada) a mesma trava
-- que create/update/delete_app_user pegam exclusiva, ANTES de qualquer linha:
-- sem ela, delete_app_user (mensagens → app_users → set null em tickets) e uma
-- RPC com o mesmo usuário (ticket → app_users pela FK) fecham ciclo e dão 40P01
-- (achado da revisão da Fase 4). VOLATILE de propósito: STABLE conferiria o
-- ator no snapshot de ANTES da espera, e um usuário apagado nela passaria.
create or replace function public.require_ticket_actor(p_user_id uuid, p_token_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('public.app_users:gestao', 0)
  );

  if pg_catalog.num_nonnulls(p_user_id, p_token_id) <> 1 then
    raise exception 'INVALID_ACTOR'
      using detail = 'Informe exatamente um ator: usuário ou token.';
  end if;

  if p_user_id is not null then
    if not exists (
      select 1 from public.app_users u where u.id = p_user_id and u.is_active
    ) then
      raise exception 'FORBIDDEN' using detail = 'Usuário inativo ou inexistente.';
    end if;
    return 'agent';
  end if;

  if not exists (
    select 1
      from public.api_tokens t
     where t.id = p_token_id
       and t.revoked_at is null
       and (t.expires_at is null or t.expires_at > pg_catalog.now())
  ) then
    raise exception 'FORBIDDEN' using detail = 'Token revogado, vencido ou inexistente.';
  end if;
  -- A Fase 5 distingue 'ai' de 'api' AQUI (create or replace), sem mudar assinatura.
  return 'api';
end;
$$;

-- 7.2 Fila e categoria existem, não estão arquivadas (salvo a atual) e combinam.
create or replace function public.assert_ticket_refs(
  p_product_id          uuid,
  p_category_id         uuid,
  p_current_product_id  uuid,
  p_current_category_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cat public.ticket_categories%rowtype;
begin
  if p_product_id is not null and p_product_id is distinct from p_current_product_id then
    if not exists (select 1 from public.products p where p.id = p_product_id) then
      raise exception 'PRODUCT_NOT_FOUND';
    end if;
    if exists (select 1 from public.products p where p.id = p_product_id and p.archived_at is not null) then
      raise exception 'PRODUCT_ARCHIVED';
    end if;
  end if;

  if p_category_id is not null then
    select * into v_cat from public.ticket_categories c where c.id = p_category_id;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND';
    end if;
    if v_cat.archived_at is not null and p_category_id is distinct from p_current_category_id then
      raise exception 'CATEGORY_ARCHIVED';
    end if;
    if v_cat.product_id is not null and v_cat.product_id is distinct from p_product_id then
      raise exception 'CATEGORY_PRODUCT_MISMATCH' using detail = 'A categoria é de outra fila.';
    end if;
  end if;
end;
$$;

-- 7.3 Contrato vigente da empresa (o único parcial de _cadastros garante ≤ 1).
create or replace function public.ticket_current_contract(p_customer_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id
    from public.support_contracts c
   where c.customer_id = p_customer_id
     and c.status in ('ativo', 'suspenso')
   limit 1;
$$;

-- 7.4 O que uma RPC devolve: sem idempotency_key, external_id, ai_triage nem token.
-- Recebe o id (e não a linha) para o PostgREST não o tratar como campo computado.
create or replace function public.ticket_summary(p_ticket_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', t.id, 'number', t.number, 'title', t.title, 'status', t.status,
    'priority', t.priority, 'version', t.version, 'conversation_id', t.conversation_id,
    'assigned_to_user_id', t.assigned_to_user_id, 'product_id', t.product_id,
    'category_id', t.category_id, 'customer_id', t.customer_id, 'contract_id', t.contract_id,
    'first_response_due_at', t.first_response_due_at, 'resolution_due_at', t.resolution_due_at,
    'first_responded_at', t.first_responded_at, 'sla_paused_at', t.sla_paused_at,
    'resolved_at', t.resolved_at, 'closed_at', t.closed_at, 'updated_at', t.updated_at
  )
    from public.tickets t
   where t.id = p_ticket_id;
$$;

create or replace function public.ticket_record_event(
  p_ticket_id      uuid,
  p_event_type     text,
  p_actor_type     text,
  p_actor_user_id  uuid,
  p_actor_token_id uuid,
  p_metadata       jsonb default '{}'::jsonb,
  p_event_key      text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.ticket_events (
    ticket_id, event_type, actor_type, actor_user_id, actor_token_id, metadata, event_key
  ) values (
    p_ticket_id, p_event_type, p_actor_type, p_actor_user_id, p_actor_token_id,
    coalesce(p_metadata, '{}'::jsonb), p_event_key
  )
  on conflict (event_key) where event_key is not null do nothing;
end;
$$;

-- 7.5 O ÚNICO lugar que muda status: matriz, relógio do SLA, carimbos, history e
-- saída do foco. Pré-condição de quem chama: ticket travado FOR NO KEY UPDATE e,
-- se o destino for terminal, a conversa travada FOR UPDATE ANTES dele.
create or replace function public.ticket_apply_transition(
  p_ticket         public.tickets,
  p_to             text,
  p_actor_type     text,
  p_actor_user_id  uuid,
  p_actor_token_id uuid,
  p_reason         text
)
returns public.tickets
language plpgsql
set search_path = ''
as $$
declare
  v_from    public.ticket_statuses%rowtype;
  v_to      public.ticket_statuses%rowtype;
  v_row     public.tickets%rowtype;
  v_allowed jsonb;
  -- now() é o início da transação; um ticket criado por transação concorrente
  -- pode ser "mais novo". greatest mantém os carimbos ≥ created_at (CHECK).
  v_now     timestamptz := greatest(pg_catalog.now(), p_ticket.created_at);
  v_secs    integer := 0;
begin
  select * into v_from from public.ticket_statuses s where s.key = p_ticket.status;
  select * into v_to   from public.ticket_statuses s where s.key = p_to;
  if v_to.key is null then
    raise exception 'INVALID_STATUS';
  end if;

  if not exists (
    select 1 from public.ticket_status_transitions tr
     where tr.from_status = v_from.key and tr.to_status = v_to.key
  ) then
    select coalesce(pg_catalog.jsonb_agg(tr.to_status order by s.position), '[]'::jsonb)
      into v_allowed
      from public.ticket_status_transitions tr
      join public.ticket_statuses s on s.key = tr.to_status
     where tr.from_status = v_from.key;
    raise exception 'INVALID_TRANSITION'
      using detail = v_allowed::text, hint = v_from.key;
  end if;

  if v_to.key = 'cancelado' and coalesce(pg_catalog.btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED' using detail = 'Informe o motivo do cancelamento.';
  end if;

  -- Retomada (parado → running): o tempo parado empurra SÓ o prazo de solução
  -- (plano §B). Segundos inteiros nos dois lados: mantém tickets_resolution_due_check.
  if v_from.sla_mode <> 'running' and v_to.sla_mode = 'running' then
    v_secs := greatest(
      pg_catalog.ceil(extract(epoch from (v_now - p_ticket.sla_paused_at)))::integer, 0
    );
  end if;

  update public.tickets t
     set status             = v_to.key,
         sla_paused_at      = case
                                when v_to.sla_mode = 'running' then null
                                when v_from.sla_mode = 'running' then v_now
                                else t.sla_paused_at      -- parado → parado: vale o 1º instante
                              end,
         sla_paused_seconds = t.sla_paused_seconds + v_secs,
         resolution_due_at  = t.resolution_due_at + pg_catalog.make_interval(secs => v_secs),
         resolved_at        = case
                                when v_to.key = 'resolvido' then v_now
                                when v_to.key = 'fechado' then t.resolved_at
                                else null
                              end,
         closed_at          = case when v_to.is_terminal then v_now else null end,
         reopened_count     = t.reopened_count
                              + case when v_from.key = 'resolvido' and not v_to.is_terminal then 1 else 0 end
   where t.id = p_ticket.id
  returning * into v_row;

  insert into public.ticket_status_history (
    ticket_id, from_status, to_status, actor_type, actor_user_id, actor_token_id, reason, occurred_at
  ) values (
    v_row.id, v_from.key, v_to.key, p_actor_type, p_actor_user_id, p_actor_token_id,
    nullif(pg_catalog.btrim(p_reason), ''), v_now
  );

  -- Invariante 5: ticket em foco que termina sai do foco.
  if v_to.is_terminal then
    update public.chat_conversations c
       set active_ticket_id = null
     where c.id = v_row.conversation_id
       and c.active_ticket_id = v_row.id;
    if found then
      perform public.ticket_record_event(
        v_row.id, 'ticket.unfocused', p_actor_type, p_actor_user_id, p_actor_token_id,
        '{"reason":"terminal"}'::jsonb);
    end if;
  end if;

  return v_row;
end;
$$;

-- 7.6 "Assumir" (4e): conversa humana, ticket em foco, responsável = analista,
-- novo|em_triagem → em_atendimento. Não reabre resolvido nem tira de aguardando_*.
-- Pré-condição: conversa FOR UPDATE e ticket FOR NO KEY UPDATE travados por quem
-- chama; ticket não terminal. Devolve true quando a conversa passou a 'human'
-- agora (o serviço avisa a IA: pushTakeoverToAgent).
create or replace function public.ticket_apply_take_over(p_ticket_id uuid, p_actor_user_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_t      public.tickets%rowtype;
  v_status text;
  v_active uuid;
  v_from   uuid;
begin
  select * into v_t from public.tickets t where t.id = p_ticket_id;
  select c.status, c.active_ticket_id into v_status, v_active
    from public.chat_conversations c where c.id = v_t.conversation_id;

  if v_status <> 'human' or v_active is distinct from p_ticket_id then
    update public.chat_conversations c
       set status = 'human',
           active_ticket_id = p_ticket_id,
           updated_at = pg_catalog.now()
     where c.id = v_t.conversation_id;
  end if;

  if v_active is distinct from p_ticket_id then
    if v_active is not null then
      perform public.ticket_record_event(v_active, 'ticket.unfocused', 'agent', p_actor_user_id, null,
        pg_catalog.jsonb_build_object('next', p_ticket_id));
    end if;
    perform public.ticket_record_event(p_ticket_id, 'ticket.focused', 'agent', p_actor_user_id, null,
      pg_catalog.jsonb_build_object('previous', v_active, 'via', 'take_over'));
  end if;

  if v_t.assigned_to_user_id is distinct from p_actor_user_id then
    v_from := v_t.assigned_to_user_id;
    update public.tickets t set assigned_to_user_id = p_actor_user_id
     where t.id = p_ticket_id
    returning * into v_t;
    perform public.ticket_record_event(p_ticket_id, 'ticket.assigned', 'agent', p_actor_user_id, null,
      pg_catalog.jsonb_build_object('from', v_from, 'to', p_actor_user_id, 'via', 'take_over'));
  end if;

  if v_t.status in ('novo', 'em_triagem') then
    perform public.ticket_apply_transition(v_t, 'em_atendimento', 'agent', p_actor_user_id, null, null);
  end if;

  return v_status <> 'human';
end;
$$;

-- ============================================================================
-- 8. Triggers
-- ============================================================================

-- 8.1 Categoria: 2 níveis, mesma fila da mãe, sem mãe arquivada.
create or replace function public.guard_ticket_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.ticket_categories%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.product_id is not null and exists (
      select 1 from public.products p where p.id = new.product_id and p.archived_at is not null
    ) then
      raise exception 'PRODUCT_ARCHIVED';
    end if;
    if new.parent_id is not null then
      select * into v_parent from public.ticket_categories c where c.id = new.parent_id;
      if found then -- inexistente: a FK responde 23503 logo depois
        if v_parent.parent_id is not null then
          raise exception 'CATEGORY_TOO_DEEP' using detail = 'Categoria tem no máximo dois níveis.';
        end if;
        if v_parent.archived_at is not null then
          raise exception 'CATEGORY_ARCHIVED';
        end if;
        if v_parent.product_id is distinct from new.product_id then
          raise exception 'CATEGORY_PRODUCT_MISMATCH'
            using detail = 'A subcategoria é da mesma fila da categoria.';
        end if;
      end if;
    end if;
    return new;
  end if;

  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from public.ticket_categories c where c.parent_id = new.id and c.archived_at is null
  ) then
    raise exception 'CATEGORY_HAS_ACTIVE_CHILDREN';
  end if;
  if old.archived_at is not null and new.archived_at is null and new.parent_id is not null and exists (
    select 1 from public.ticket_categories c where c.id = new.parent_id and c.archived_at is not null
  ) then
    raise exception 'CATEGORY_ARCHIVED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ticket_categories_guard on public.ticket_categories;
create trigger trg_ticket_categories_guard
  before insert or update of archived_at on public.ticket_categories
  for each row execute function public.guard_ticket_category();

drop trigger if exists trg_ticket_categories_set_updated_at on public.ticket_categories;
create trigger trg_ticket_categories_set_updated_at
  before update on public.ticket_categories
  for each row execute function public.set_updated_at();
drop trigger if exists trg_ticket_statuses_set_updated_at on public.ticket_statuses;
create trigger trg_ticket_statuses_set_updated_at
  before update on public.ticket_statuses
  for each row execute function public.set_updated_at();
drop trigger if exists trg_sla_policies_set_updated_at on public.sla_policies;
create trigger trg_sla_policies_set_updated_at
  before update on public.sla_policies
  for each row execute function public.set_updated_at();

-- 8.2 Guarda de tickets para QUALQUER escritor (até o dono): imutáveis, matriz e
-- versão. A versão só sobe em coluna de negócio: carimbo de 1ª resposta não
-- derruba o formulário aberto de ninguém.
create or replace function public.guard_ticket_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.conversation_id is distinct from old.conversation_id
     or new.contact_id is distinct from old.contact_id
     or new.created_at is distinct from old.created_at
     or new.source is distinct from old.source
     or new.idempotency_key is distinct from old.idempotency_key
     or new.external_id is distinct from old.external_id
     or new.created_by_token_id is distinct from old.created_by_token_id
     or (new.created_by_user_id is not null
         and new.created_by_user_id is distinct from old.created_by_user_id) then
    raise exception 'TICKET_IMMUTABLE'
      using detail = 'Conversa, contato, origem, criador e chaves do ticket não mudam.';
  end if;

  if new.status <> old.status and not exists (
    select 1 from public.ticket_status_transitions tr
     where tr.from_status = old.status and tr.to_status = new.status
  ) then
    raise exception 'INVALID_TRANSITION' using hint = old.status;
  end if;

  if (new.title, new.description, new.status, new.priority, new.product_id, new.category_id,
      new.customer_id, new.contract_id, new.assigned_to_user_id)
     is distinct from
     (old.title, old.description, old.status, old.priority, old.product_id, old.category_id,
      old.customer_id, old.contract_id, old.assigned_to_user_id) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists trg_tickets_guard_update on public.tickets;
create trigger trg_tickets_guard_update
  before update on public.tickets
  for each row execute function public.guard_ticket_update();

-- 8.3 Trilha append-only, até para o dono (molde prevent_contact_event_mutation).
create or replace function public.prevent_ticket_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'TICKET_LOG_APPEND_ONLY' using errcode = '0A000';
end;
$$;

drop trigger if exists trg_ticket_status_history_append_only on public.ticket_status_history;
create trigger trg_ticket_status_history_append_only
  before update or delete on public.ticket_status_history
  for each row execute function public.prevent_ticket_log_mutation();
drop trigger if exists trg_ticket_events_append_only on public.ticket_events;
create trigger trg_ticket_events_append_only
  before update or delete on public.ticket_events
  for each row execute function public.prevent_ticket_log_mutation();

-- 8.4 Comentário: autor obrigatório no INSERT; apagar é terminal e zera o texto;
-- edição carimbada pelo banco. "Só o autor" é da rota (par de note-actions).
create or replace function public.guard_ticket_comment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if pg_catalog.num_nonnulls(new.author_user_id, new.author_token_id) <> 1 then
      raise exception 'INVALID_ACTOR' using detail = 'Comentário precisa de um autor.';
    end if;
    return new;
  end if;

  if old.deleted_at is not null
     and (new.body is distinct from old.body or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'COMMENT_DELETED';
  end if;
  if old.deleted_at is null and new.deleted_at is not null then
    new.deleted_at := pg_catalog.now();
    new.body := null;
  elsif new.body is distinct from old.body then
    new.edited_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ticket_comments_guard on public.ticket_comments;
create trigger trg_ticket_comments_guard
  before insert or update on public.ticket_comments
  for each row execute function public.guard_ticket_comment();

-- 8.5 O foco só muda pelas RPCs. INVOKER de propósito: dentro de uma RPC definer
-- current_user é o dono; direto do app é service_role. Guard em vez de grant por
-- coluna: chat_conversations tem UPDATE de tabela e muitos escritores (webhook,
-- start, PATCH, triggers invoker); fechar por coluna arriscaria 42501 no caminho
-- quente.
create or replace function public.guard_conversation_active_ticket()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if ((tg_op = 'INSERT' and new.active_ticket_id is not null)
      or (tg_op = 'UPDATE' and new.active_ticket_id is distinct from old.active_ticket_id))
     and current_user::text in ('service_role', 'authenticated', 'anon') then
    raise exception 'ACTIVE_TICKET_READ_ONLY'
      using detail = 'O ticket em foco muda só pelas RPCs de ticket.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_conversations_guard_active_ticket on public.chat_conversations;
create trigger trg_chat_conversations_guard_active_ticket
  before insert or update of active_ticket_id on public.chat_conversations
  for each row execute function public.guard_conversation_active_ticket();

-- 8.6 Carimbo (plano A.2): toda mensagem nasce no ticket em foco; o valor que o
-- app mandar é ignorado.
--   FOR KEY SHARE na conversa: é o MESMO modo que a FK da mensagem já pega
--   (RI_ConstraintTrigger_c_* dispara antes dos trg_*). Compatível com outras
--   mensagens e com o NO KEY UPDATE de increment_unread e do rename de contato
--   → nenhum deadlock novo. Conflita só com FOR UPDATE, que é o que
--   create_ticket, ticket_set_active, ticket_take_over e a transição para
--   terminal pegam: a mensagem espera o foco novo em vez de ficar solta. Depois
--   da espera, o READ COMMITTED devolve a versão nova da linha.
--   Nome "stamp" ordena depois de "scrub_deleted"; os dois são independentes.
create or replace function public.stamp_chat_message_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active uuid;
begin
  select c.active_ticket_id into v_active
    from public.chat_conversations c
   where c.id = new.conversation_id
     for key share;
  new.ticket_id := v_active;
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_stamp_ticket on public.chat_messages;
create trigger trg_chat_messages_stamp_ticket
  before insert on public.chat_messages
  for each row execute function public.stamp_chat_message_ticket();

-- 8.7 SLA a partir da mensagem.
--   1ª resposta = mensagem HUMANA (agent, não nota) ACEITA pelo provedor
--   (sent|delivered|read), nunca antes da abertura. Envio nasce 'pending' e pode
--   virar 'failed': contar no INSERT marcaria respondido o que o cliente nunca
--   recebeu. O instante é o do ACEITE: no INSERT já aceito, o created_at; no
--   UPDATE que aceita, now(). O reenvio de 'failed' reaproveita a linha com o
--   created_at da tentativa que falhou (send/route.ts), e contar por ele daria
--   por cumprido um prazo que o cliente viu estourar (achado da revisão). No
--   envio normal, pending→sent sai segundos depois do created_at. device e
--   system não contam (decisão 3). A da IA vai para first_ai_response_at.
--   Retomada (pergunta Q2): cliente responde com o ticket em aguardando_cliente
--   → em_atendimento, ator 'system'. Mensagem anterior à pausa (retry atrasado
--   do provedor) não retoma. resolvido NÃO reabre sozinho.
-- ⚠️ ORDEM: "ticket_sla" ordena DEPOIS de "increment_unread". A mensagem trava
-- contacts → conversa → ticket, a mesma ordem das RPCs (conversa → ticket).
-- Um nome que ordene antes de "increment_unread" reabre o deadlock (teste T99).
create or replace function public.ticket_sla_from_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t  public.tickets%rowtype;
  v_at timestamptz := case when tg_op = 'UPDATE' then pg_catalog.now() else new.created_at end;
begin
  if new.delivery_status in ('sent', 'delivered', 'read') then
    if new.sender_type = 'agent' then
      update public.tickets t
         set first_responded_at = greatest(v_at, t.created_at)
       where t.id = new.ticket_id
         and t.first_responded_at is null
         and t.closed_at is null;
    elsif new.sender_type = 'ai' then
      update public.tickets t
         set first_ai_response_at = greatest(v_at, t.created_at)
       where t.id = new.ticket_id
         and t.first_ai_response_at is null
         and t.closed_at is null;
    end if;
  end if;

  if tg_op = 'INSERT' and new.direction = 'inbound' then
    select * into v_t from public.tickets t where t.id = new.ticket_id;
    if v_t.status = 'aguardando_cliente' and new.created_at >= v_t.sla_paused_at then
      select * into v_t from public.tickets t where t.id = new.ticket_id for no key update;
      if v_t.status = 'aguardando_cliente' and new.created_at >= v_t.sla_paused_at then
        perform public.ticket_apply_transition(
          v_t, 'em_atendimento', 'system', null, null, 'Cliente respondeu');
      end if;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_chat_messages_ticket_sla_ins on public.chat_messages;
create trigger trg_chat_messages_ticket_sla_ins
  after insert on public.chat_messages
  for each row when (new.ticket_id is not null and new.type <> 'note')
  execute function public.ticket_sla_from_chat_message();

drop trigger if exists trg_chat_messages_ticket_sla_upd on public.chat_messages;
create trigger trg_chat_messages_ticket_sla_upd
  after update of delivery_status on public.chat_messages
  for each row when (
    new.ticket_id is not null
    and new.type <> 'note'
    and new.sender_type in ('agent', 'ai')
    and new.delivery_status in ('sent', 'delivered', 'read')
    and old.delivery_status not in ('sent', 'delivered', 'read')
  )
  execute function public.ticket_sla_from_chat_message();

-- ============================================================================
-- 9. RPCs (só service_role). Ordem de travas: gestão de usuários (compartilhada,
--    em require_ticket_actor) → conversa → ticket.
--    Atores: p_actor_user_id OU p_actor_token_id, ambos default null (o
--    db:types os gera opcionais; a rota omite a chave com ?? undefined).
-- ============================================================================

create or replace function public.create_ticket(
  p_conversation_id     uuid,
  p_title               text,
  p_priority            text    default 'media',
  p_actor_user_id       uuid    default null,
  p_actor_token_id      uuid    default null,
  p_description         text    default null,
  p_product_id          uuid    default null,
  p_category_id         uuid    default null,
  p_assigned_to_user_id uuid    default null,
  p_idempotency_key     text    default null,
  p_set_active          boolean default true,
  p_take_over           boolean default false,
  p_status              text    default 'novo',
  p_source              text    default null,
  p_external_id         text    default null,
  p_ai_triage           jsonb   default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     text;
  v_source    text;
  v_take      boolean := coalesce(p_take_over, false);
  v_conv      public.chat_conversations%rowtype;
  v_existing  public.tickets%rowtype;
  v_policy    public.sla_policies%rowtype;
  v_customer  uuid;
  v_t         public.tickets%rowtype;
  v_now       timestamptz := pg_catalog.now();
  v_since     timestamptz;
  v_linked    integer := 0;
  v_human     boolean := false;
  v_ai        boolean := false;
  v_changed   boolean := false;
begin
  v_actor := public.require_ticket_actor(p_actor_user_id, p_actor_token_id);
  if v_actor = 'agent' then
    if (p_source is not null and p_source <> 'agent')
       or p_external_id is not null or p_ai_triage is not null then
      raise exception 'INVALID_SOURCE'
        using detail = 'Ticket aberto na tela é do analista; external_id e ai_triage são da integração.';
    end if;
    v_source := 'agent';
  else
    if v_take then
      raise exception 'FORBIDDEN' using detail = 'Só um analista assume o atendimento.';
    end if;
    v_source := coalesce(p_source, 'api');
    if v_source not in ('ai', 'api') then
      raise exception 'INVALID_SOURCE';
    end if;
  end if;
  if coalesce(p_status, 'novo') not in ('novo', 'em_triagem') then
    raise exception 'INVALID_INITIAL_STATUS' using detail = 'Ticket nasce em novo ou em_triagem.';
  end if;
  if v_take and p_assigned_to_user_id is not null and p_assigned_to_user_id <> p_actor_user_id then
    raise exception 'INVALID_ASSIGNEE' using detail = 'Assumir já atribui o ticket a quem abre.';
  end if;

  -- Trava 1: a conversa, FOR UPDATE (espera as mensagens em voo; §8.6) e
  -- serializa aberturas simultâneas na mesma conversa.
  select * into v_conv from public.chat_conversations c
   where c.id = p_conversation_id
     for update;
  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;

  -- Idempotência POR ATOR: a chave (ou o external_id) de um integrador nunca
  -- devolve o ticket de outro.
  if p_idempotency_key is not null or (p_external_id is not null and p_actor_token_id is not null) then
    select * into v_existing from public.tickets t
     where (p_idempotency_key is not null
            and t.idempotency_key = p_idempotency_key
            and (t.created_by_user_id = p_actor_user_id or t.created_by_token_id = p_actor_token_id))
        or (p_external_id is not null
            and t.created_by_token_id = p_actor_token_id
            and t.external_id = p_external_id)
     limit 1;
    if found then
      if v_existing.conversation_id <> p_conversation_id then
        raise exception 'IDEMPOTENCY_KEY_REUSED';
      end if;
      return pg_catalog.jsonb_build_object(
        'ticket', public.ticket_summary(v_existing.id), 'created', false, 'linked_messages', 0,
        'conversation_changed', false, 'conversation_external_id', v_conv.external_id);
    end if;
  end if;

  select * into v_policy from public.sla_policies p where p.priority = p_priority;
  if not found then
    raise exception 'INVALID_PRIORITY';
  end if;

  perform public.assert_ticket_refs(p_product_id, p_category_id, null, null);

  if p_assigned_to_user_id is not null and not exists (
    select 1 from public.app_users u where u.id = p_assigned_to_user_id and u.is_active
  ) then
    raise exception 'ASSIGNEE_INACTIVE';
  end if;

  -- Empresa do contato, se ativa. Contrato = o vigente dela (derivado, nunca informado).
  select ct.customer_id into v_customer
    from public.contacts ct
    join public.customers cu on cu.id = ct.customer_id and cu.archived_at is null
   where ct.id = v_conv.contact_id;

  insert into public.tickets (
    title, description, status, priority,
    conversation_id, contact_id, customer_id, contract_id,
    product_id, category_id, assigned_to_user_id,
    source, created_by_user_id, created_by_token_id,
    idempotency_key, external_id, ai_triage,
    sla_first_response_minutes, sla_resolution_minutes, sla_warn_pct,
    first_response_due_at, resolution_due_at, created_at, updated_at
  ) values (
    pg_catalog.btrim(p_title), nullif(pg_catalog.btrim(p_description), ''),
    coalesce(p_status, 'novo'), p_priority,
    p_conversation_id, v_conv.contact_id, v_customer, public.ticket_current_contract(v_customer),
    p_product_id, p_category_id, p_assigned_to_user_id,
    v_source, p_actor_user_id, p_actor_token_id,
    p_idempotency_key, p_external_id, p_ai_triage,
    v_policy.first_response_minutes, v_policy.resolution_minutes, v_policy.warn_pct,
    v_now + pg_catalog.make_interval(mins => v_policy.first_response_minutes),
    v_now + pg_catalog.make_interval(mins => v_policy.resolution_minutes),
    v_now, v_now
  )
  on conflict do nothing
  returning * into v_t;

  -- Conflito aqui = mesma chave (ou external_id) do mesmo ator vinda de OUTRA
  -- conversa ao mesmo tempo (esta conversa está travada acima).
  if v_t.id is null then
    select * into v_existing from public.tickets t
     where (p_idempotency_key is not null
            and t.idempotency_key = p_idempotency_key
            and (t.created_by_user_id = p_actor_user_id or t.created_by_token_id = p_actor_token_id))
        or (p_external_id is not null
            and t.created_by_token_id = p_actor_token_id
            and t.external_id = p_external_id)
     limit 1;
    if v_existing.id is not null and v_existing.conversation_id = p_conversation_id then
      return pg_catalog.jsonb_build_object(
        'ticket', public.ticket_summary(v_existing.id), 'created', false, 'linked_messages', 0,
        'conversation_changed', false, 'conversation_external_id', v_conv.external_id);
    end if;
    raise exception 'IDEMPOTENCY_KEY_REUSED';
  end if;

  insert into public.ticket_status_history (
    ticket_id, from_status, to_status, actor_type, actor_user_id, actor_token_id, occurred_at
  ) values (v_t.id, null, v_t.status, v_source, p_actor_user_id, p_actor_token_id, v_now);

  perform public.ticket_record_event(v_t.id, 'ticket.created', v_source,
    p_actor_user_id, p_actor_token_id,
    pg_catalog.jsonb_build_object('source', v_source), 'ticket.created:' || v_t.id::text);

  if p_assigned_to_user_id is not null then
    perform public.ticket_record_event(v_t.id, 'ticket.assigned', v_source,
      p_actor_user_id, p_actor_token_id,
      pg_catalog.jsonb_build_object('from', null, 'to', p_assigned_to_user_id));
  end if;

  -- Soltas recentes vão para o ticket novo: até 24 h (plano §B), e nunca de antes
  -- do último ticket encerrado desta conversa (eram o fim do outro assunto).
  select pg_catalog.max(t.closed_at) into v_since
    from public.tickets t where t.conversation_id = p_conversation_id;
  v_since := greatest(v_now - interval '24 hours', coalesce(v_since, '-infinity'::timestamptz));

  with linked as (
    update public.chat_messages m
       set ticket_id = v_t.id
     where m.conversation_id = p_conversation_id
       and m.ticket_id is null
       and m.created_at >= v_since
    returning m.sender_type, m.type, m.delivery_status
  )
  select pg_catalog.count(*)::integer,
         coalesce(pg_catalog.bool_or(l.sender_type = 'agent' and l.type <> 'note'
                  and l.delivery_status in ('sent', 'delivered', 'read')), false),
         coalesce(pg_catalog.bool_or(l.sender_type = 'ai'
                  and l.delivery_status in ('sent', 'delivered', 'read')), false)
    into v_linked, v_human, v_ai
    from linked l;

  -- Pergunta Q4: resposta humana já entregue antes da abertura conta como 1ª
  -- resposta NA abertura (o cliente já foi atendido). O UPDATE do vínculo não
  -- dispara o trigger 8.7 (é OF delivery_status), por isso é feito aqui.
  if v_human or v_ai then
    update public.tickets t
       set first_responded_at   = case when v_human then t.created_at else t.first_responded_at end,
           first_ai_response_at = case when v_ai then t.created_at else t.first_ai_response_at end
     where t.id = v_t.id;
  end if;

  if v_linked > 0 then
    perform public.ticket_record_event(v_t.id, 'ticket.messages_linked', v_source,
      p_actor_user_id, p_actor_token_id,
      pg_catalog.jsonb_build_object('count', v_linked, 'since', v_since));
  end if;

  if coalesce(p_set_active, true) or v_take then
    update public.chat_conversations c set active_ticket_id = v_t.id where c.id = p_conversation_id;
    if v_conv.active_ticket_id is not null then
      perform public.ticket_record_event(v_conv.active_ticket_id, 'ticket.unfocused', v_source,
        p_actor_user_id, p_actor_token_id, pg_catalog.jsonb_build_object('next', v_t.id));
    end if;
    perform public.ticket_record_event(v_t.id, 'ticket.focused', v_source,
      p_actor_user_id, p_actor_token_id,
      pg_catalog.jsonb_build_object('previous', v_conv.active_ticket_id));
  end if;

  -- "Assumir o atendimento" na MESMA transação (4e).
  if v_take then
    v_changed := public.ticket_apply_take_over(v_t.id, p_actor_user_id);
  end if;

  return pg_catalog.jsonb_build_object(
    'ticket', public.ticket_summary(v_t.id), 'created', true, 'linked_messages', v_linked,
    'conversation_changed', v_changed, 'conversation_external_id', v_conv.external_id);
end;
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
begin
  v_actor := public.require_ticket_actor(p_actor_user_id, p_actor_token_id);

  if p_patch is null
     or pg_catalog.jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_patch) as k(key)
        where k.key not in ('title', 'description', 'priority', 'product_id', 'category_id', 'customer_id')
     ) then
    raise exception 'INVALID_PATCH';
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
    p_actor_user_id, p_actor_token_id, pg_catalog.jsonb_build_object('changes', v_changes));

  return pg_catalog.jsonb_build_object('ticket', public.ticket_summary(v_new.id), 'changed', true);
end;
$$;

create or replace function public.ticket_transition(
  p_ticket_id        uuid,
  p_to               text,
  p_expected_version integer,
  p_actor_user_id    uuid default null,
  p_actor_token_id   uuid default null,
  p_reason           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   text;
  v_conv_id uuid;
  v_to      public.ticket_statuses%rowtype;
  v_t       public.tickets%rowtype;
  v_from    text;
begin
  v_actor := public.require_ticket_actor(p_actor_user_id, p_actor_token_id);

  select * into v_to from public.ticket_statuses s where s.key = p_to;
  if not found then
    raise exception 'INVALID_STATUS';
  end if;

  -- conversation_id é imutável (guard_ticket_update): ler sem trava é seguro.
  select t.conversation_id into v_conv_id from public.tickets t where t.id = p_ticket_id;
  if not found then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  -- Destino terminal pode tirar o ticket do foco: conversa ANTES do ticket.
  if v_to.is_terminal then
    perform 1 from public.chat_conversations c where c.id = v_conv_id for update;
  end if;

  select * into v_t from public.tickets t where t.id = p_ticket_id for no key update;

  if v_t.status = p_to then
    return pg_catalog.jsonb_build_object('ticket', public.ticket_summary(v_t.id),
      'from', v_t.status, 'to', p_to, 'changed', false);
  end if;
  if p_expected_version is null or v_t.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using detail = v_t.version::text;
  end if;

  v_from := v_t.status;
  v_t := public.ticket_apply_transition(v_t, p_to, v_actor, p_actor_user_id, p_actor_token_id, p_reason);

  return pg_catalog.jsonb_build_object('ticket', public.ticket_summary(v_t.id),
    'from', v_from, 'to', p_to, 'changed', true);
end;
$$;

create or replace function public.ticket_assign(
  p_ticket_id        uuid,
  p_expected_version integer,
  p_assignee_id      uuid default null,
  p_actor_user_id    uuid default null,
  p_actor_token_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_t     public.tickets%rowtype;
  v_from  uuid;
begin
  v_actor := public.require_ticket_actor(p_actor_user_id, p_actor_token_id);

  select * into v_t from public.tickets t where t.id = p_ticket_id for no key update;
  if not found then
    raise exception 'TICKET_NOT_FOUND';
  end if;
  if v_t.closed_at is not null then
    raise exception 'TICKET_TERMINAL';
  end if;
  if v_t.assigned_to_user_id is not distinct from p_assignee_id then
    return pg_catalog.jsonb_build_object('ticket', public.ticket_summary(v_t.id), 'changed', false);
  end if;
  if p_expected_version is null or v_t.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using detail = v_t.version::text;
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.app_users u where u.id = p_assignee_id and u.is_active
  ) then
    raise exception 'ASSIGNEE_INACTIVE';
  end if;

  v_from := v_t.assigned_to_user_id;
  update public.tickets t set assigned_to_user_id = p_assignee_id where t.id = v_t.id;

  perform public.ticket_record_event(v_t.id, 'ticket.assigned', v_actor,
    p_actor_user_id, p_actor_token_id,
    pg_catalog.jsonb_build_object('from', v_from, 'to', p_assignee_id));

  return pg_catalog.jsonb_build_object('ticket', public.ticket_summary(v_t.id), 'changed', true);
end;
$$;

create or replace function public.ticket_set_active(
  p_conversation_id uuid,
  p_ticket_id       uuid default null,
  p_actor_user_id   uuid default null,
  p_actor_token_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   text;
  v_current uuid;
  v_t       public.tickets%rowtype;
begin
  v_actor := public.require_ticket_actor(p_actor_user_id, p_actor_token_id);

  -- FOR UPDATE: serializa com o carimbo e com a transição para terminal (que
  -- também trava a conversa primeiro); ler o status do ticket depois é seguro.
  select c.active_ticket_id into v_current from public.chat_conversations c
   where c.id = p_conversation_id
     for update;
  if not found then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;

  if p_ticket_id is not null then
    select * into v_t from public.tickets t where t.id = p_ticket_id;
    if not found or v_t.conversation_id <> p_conversation_id then
      raise exception 'TICKET_NOT_IN_CONVERSATION';
    end if;
    if v_t.closed_at is not null then
      raise exception 'TICKET_TERMINAL';
    end if;
  end if;

  if v_current is not distinct from p_ticket_id then
    return pg_catalog.jsonb_build_object('active_ticket_id', v_current, 'changed', false);
  end if;

  update public.chat_conversations c set active_ticket_id = p_ticket_id where c.id = p_conversation_id;

  if v_current is not null then
    perform public.ticket_record_event(v_current, 'ticket.unfocused', v_actor,
      p_actor_user_id, p_actor_token_id, pg_catalog.jsonb_build_object('next', p_ticket_id));
  end if;
  if p_ticket_id is not null then
    perform public.ticket_record_event(p_ticket_id, 'ticket.focused', v_actor,
      p_actor_user_id, p_actor_token_id, pg_catalog.jsonb_build_object('previous', v_current));
  end if;

  return pg_catalog.jsonb_build_object('active_ticket_id', p_ticket_id, 'changed', true);
end;
$$;

-- "Assumir" pelo ticket (chat e Início). Tomar o ticket de outro exige
-- p_reassign (confirmação na tela). Só usuário: a IA nunca assume (ela só passa
-- bot→human pela API da Fase 5).
create or replace function public.ticket_take_over(
  p_ticket_id     uuid,
  p_actor_user_id uuid,
  p_reassign      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_id  uuid;
  v_external text;
  v_t        public.tickets%rowtype;
  v_changed  boolean;
begin
  if p_actor_user_id is null then
    raise exception 'INVALID_ACTOR' using detail = 'Só um analista assume o atendimento.';
  end if;
  perform public.require_ticket_actor(p_actor_user_id, null);

  select t.conversation_id into v_conv_id from public.tickets t where t.id = p_ticket_id;
  if not found then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  -- O foco pode mudar: conversa FOR UPDATE, e ANTES do ticket.
  select c.external_id into v_external from public.chat_conversations c
   where c.id = v_conv_id
     for update;
  select * into v_t from public.tickets t where t.id = p_ticket_id for no key update;

  if v_t.closed_at is not null then
    raise exception 'TICKET_TERMINAL';
  end if;
  if v_t.assigned_to_user_id is not null
     and v_t.assigned_to_user_id <> p_actor_user_id
     and not coalesce(p_reassign, false) then
    raise exception 'ALREADY_ASSIGNED' using detail = v_t.assigned_to_user_id::text;
  end if;

  v_changed := public.ticket_apply_take_over(p_ticket_id, p_actor_user_id);

  return pg_catalog.jsonb_build_object(
    'ticket', public.ticket_summary(p_ticket_id),
    'conversation_id', v_conv_id,
    'conversation_status', 'human',
    'conversation_changed', v_changed,
    'conversation_external_id', v_external);
end;
$$;

-- ============================================================================
-- 10. Funções portadas: corpo IDÊNTICO + o ramo novo
-- ============================================================================

-- 10.1 20260925120400_chat.sql §8.6 + reopen_on_inbound (plano §B): inbound em
-- conversa resolvida volta para a IA, no MESMO UPDATE (uma trava, um evento de
-- Realtime). O webhook relê o status depois do INSERT (upsert-message.ts).
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
      status = case
        when new.direction = 'inbound' and status = 'resolved' then 'bot'
        else status
      end,
      updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

-- 10.2 20260925120400_chat.sql §9.1 + a recusa prometida no comentário da
-- linha 727: limpar apagaria o que a timeline do ticket mostra.
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

  if exists (select 1 from public.tickets t where t.conversation_id = p_conversation_id) then
    raise exception 'CONVERSATION_HAS_TICKETS'
      using detail = 'A conversa tem ticket: limpar apagaria o histórico do atendimento.';
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

-- ============================================================================
-- 11. View de leitura: o SLA num lugar que o PostgREST filtra e ordena (ele não
-- compara coluna com coluna). lib/sla.ts repete a MESMA regra para o texto do
-- selo; T95 e sla.test.ts usam a mesma tabela de casos.
-- ============================================================================
create or replace view public.ticket_queue
with (security_invoker = true)
as
select
  t.id, t.number, t.title, t.description, t.status, t.priority, t.version,
  t.conversation_id, t.contact_id, t.customer_id, t.contract_id,
  t.product_id, t.category_id, t.assigned_to_user_id, t.created_by_user_id,
  t.source, t.reopened_count,
  t.sla_first_response_minutes, t.sla_resolution_minutes, t.sla_warn_pct,
  t.first_response_due_at, t.resolution_due_at,
  t.first_responded_at, t.first_ai_response_at,
  t.sla_paused_at, t.sla_paused_seconds, t.resolved_at, t.closed_at,
  t.created_at, t.updated_at,
  s.sla_mode, s.is_terminal, p.rank as priority_rank,
  b.first_response_overdue,
  b.resolution_overdue,
  (b.first_response_overdue or b.resolution_overdue) as sla_breached,
  ( not (b.first_response_overdue or b.resolution_overdue)
    and s.sla_mode <> 'stopped'
    and ( (t.first_responded_at is null
           and pg_catalog.now() >= t.first_response_due_at
               - pg_catalog.make_interval(secs => t.sla_first_response_minutes * (100 - t.sla_warn_pct) * 0.6))
       or (s.sla_mode = 'running'
           and pg_catalog.now() >= t.resolution_due_at
               - pg_catalog.make_interval(secs => t.sla_resolution_minutes * (100 - t.sla_warn_pct) * 0.6)) )
  ) as sla_at_risk,
  case
    when s.sla_mode = 'stopped' then null
    when t.first_responded_at is null then t.first_response_due_at
    when s.sla_mode = 'running' then t.resolution_due_at
  end as next_due_at,
  -- "Cliente respondeu depois de resolver" (4d) e, na Fase 6, o sweep não fecha.
  (select pg_catalog.max(m.created_at)
     from public.chat_messages m
    where m.ticket_id = t.id and m.direction = 'inbound') as last_inbound_at,
  pg_catalog.concat_ws(' ', t.search_title, ct.search_name, cu.search_name) as search_text
from public.tickets t
join public.ticket_statuses s on s.key = t.status
join public.sla_policies p on p.priority = t.priority
join public.contacts ct on ct.id = t.contact_id
left join public.customers cu on cu.id = t.customer_id
cross join lateral (
  select
    -- 1ª resposta: relógio de parede (não pausa); some quando responde ou para.
    (t.first_responded_at is null and s.sla_mode <> 'stopped'
     and t.first_response_due_at <= pg_catalog.now()) as first_response_overdue,
    -- Solução: parada, vale o instante em que parou.
    (s.sla_mode <> 'stopped'
     and t.resolution_due_at <= coalesce(t.sla_paused_at, pg_catalog.now())) as resolution_overdue
) b;

revoke all on public.ticket_queue from public, anon, authenticated, service_role;
grant select on public.ticket_queue to service_role;

-- ============================================================================
-- 12. Bucket privado ticket-attachments: MESMOS teto e tipos do chat-media (o
-- app reusa CHAT_MEDIA_ALLOWED_MIME/storageContentType). Sem policy em
-- storage.objects; leitura por URL assinada curta.
-- ============================================================================
do $$
declare
  v_limit bigint;
  v_mimes text[];
begin
  if to_regclass('storage.buckets') is null then
    raise warning
      'schema storage ausente: bucket ticket-attachments NÃO foi criado. Suba o storage-api e rode à mão o bloco 12 de 20260925120900_tickets.sql.';
    return;
  end if;
  select b.file_size_limit, b.allowed_mime_types into v_limit, v_mimes
    from storage.buckets b where b.id = 'chat-media';
  if v_mimes is null then
    raise exception 'TICKETS: chat-media ausente ou sem lista de tipos (20260925120500 §1)';
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ticket-attachments', 'ticket-attachments', false, v_limit, v_mimes)
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;

-- ============================================================================
-- 13. EXECUTE: fechado para PUBLIC/anon/authenticated em TODA função; helpers
-- internos fechados também para o service_role.
-- ============================================================================
revoke all on function public.require_ticket_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_ticket_refs(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ticket_current_contract(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ticket_summary(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ticket_record_event(uuid, text, text, uuid, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.ticket_apply_transition(public.tickets, text, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.ticket_apply_take_over(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.guard_ticket_category() from public, anon, authenticated;
revoke all on function public.guard_ticket_update() from public, anon, authenticated;
revoke all on function public.prevent_ticket_log_mutation() from public, anon, authenticated;
revoke all on function public.guard_ticket_comment() from public, anon, authenticated;
revoke all on function public.guard_conversation_active_ticket() from public, anon, authenticated;
revoke all on function public.stamp_chat_message_ticket() from public, anon, authenticated;
revoke all on function public.ticket_sla_from_chat_message() from public, anon, authenticated;
revoke all on function public.increment_unread_from_inserted_message() from public, anon, authenticated;
revoke all on function public.clear_chat_conversation(uuid) from public, anon, authenticated;
revoke all on function public.create_ticket(uuid, text, text, uuid, uuid, text, uuid, uuid, uuid, text, boolean, boolean, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.ticket_update(uuid, integer, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ticket_transition(uuid, text, integer, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ticket_assign(uuid, integer, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ticket_set_active(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ticket_take_over(uuid, uuid, boolean) from public, anon, authenticated;

-- Funções de trigger: mesmo padrão de _chat/_cadastros.
grant execute on function public.guard_ticket_category() to service_role;
grant execute on function public.guard_ticket_update() to service_role;
grant execute on function public.prevent_ticket_log_mutation() to service_role;
grant execute on function public.guard_ticket_comment() to service_role;
grant execute on function public.guard_conversation_active_ticket() to service_role;
grant execute on function public.stamp_chat_message_ticket() to service_role;
grant execute on function public.ticket_sla_from_chat_message() to service_role;
grant execute on function public.increment_unread_from_inserted_message() to service_role;
grant execute on function public.clear_chat_conversation(uuid) to service_role;
grant execute on function public.create_ticket(uuid, text, text, uuid, uuid, text, uuid, uuid, uuid, text, boolean, boolean, text, text, text, jsonb)
  to service_role;
grant execute on function public.ticket_update(uuid, integer, jsonb, uuid, uuid) to service_role;
grant execute on function public.ticket_transition(uuid, text, integer, uuid, uuid, text) to service_role;
grant execute on function public.ticket_assign(uuid, integer, uuid, uuid, uuid) to service_role;
grant execute on function public.ticket_set_active(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.ticket_take_over(uuid, uuid, boolean) to service_role;

-- ============================================================================
-- 14. Asserções locais (o que o baseline geral não confere)
-- ============================================================================
do $$
declare
  v_to text[];
begin
  if pg_catalog.has_any_column_privilege('service_role', 'public.tickets', 'INSERT, UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.tickets', 'DELETE') then
    raise exception 'TICKETS: service_role escreve em tickets; a escrita é só pelas RPCs';
  end if;
  if pg_catalog.has_any_column_privilege('service_role', 'public.ticket_status_history', 'INSERT, UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.ticket_status_history', 'DELETE')
     or pg_catalog.has_any_column_privilege('service_role', 'public.ticket_events', 'INSERT, UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.ticket_events', 'DELETE') then
    raise exception 'TICKETS: service_role escreve na trilha (append-only, gravada pelas RPCs)';
  end if;
  if pg_catalog.has_column_privilege('service_role', 'public.chat_messages', 'ticket_id', 'UPDATE') then
    raise exception 'TICKETS: service_role move mensagem de ticket; só o carimbo e create_ticket fazem isso';
  end if;
  if pg_catalog.has_any_column_privilege('service_role', 'public.ticket_statuses', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.ticket_statuses', 'DELETE')
     or pg_catalog.has_column_privilege('service_role', 'public.ticket_statuses', 'key', 'UPDATE')
     or pg_catalog.has_column_privilege('service_role', 'public.ticket_statuses', 'sla_mode', 'UPDATE')
     or pg_catalog.has_column_privilege('service_role', 'public.ticket_statuses', 'is_terminal', 'UPDATE')
     or pg_catalog.has_column_privilege('service_role', 'public.ticket_statuses', 'position', 'UPDATE')
     or pg_catalog.has_any_column_privilege('service_role', 'public.ticket_status_transitions', 'INSERT, UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.ticket_status_transitions', 'DELETE') then
    raise exception 'TICKETS: status e matriz são fixos (decisão 11); só rótulo e cor são do admin';
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.ticket_comments', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.ticket_attachments', 'DELETE')
     or pg_catalog.has_any_column_privilege('service_role', 'public.ticket_attachments', 'UPDATE') then
    raise exception 'TICKETS: comentário se apaga por deleted_at; anexo não se altera';
  end if;
  if pg_catalog.has_function_privilege('service_role', 'public.require_ticket_actor(uuid,uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.assert_ticket_refs(uuid,uuid,uuid,uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.ticket_current_contract(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.ticket_summary(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',
          'public.ticket_record_event(uuid,text,text,uuid,uuid,jsonb,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',
          'public.ticket_apply_transition(public.tickets,text,text,uuid,uuid,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.ticket_apply_take_over(uuid,uuid)', 'EXECUTE') then
    raise exception 'TICKETS: helper interno virou RPC';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('create_ticket', 'ticket_update', 'ticket_transition',
                         'ticket_assign', 'ticket_set_active', 'ticket_take_over')
     group by p.proname having pg_catalog.count(*) > 1
  ) then
    raise exception 'TICKETS: sobrecarga de RPC de ticket; a chamada ficaria ambígua';
  end if;

  -- Catálogo coerente com os CHECKs literais de tickets.
  if (select pg_catalog.count(*) from public.ticket_statuses) <> 8
     or exists (
       select 1 from public.ticket_statuses s
        where (s.sla_mode = 'running') <> (s.key in ('novo', 'em_triagem', 'em_atendimento', 'aguardando_interno'))
           or (s.sla_mode = 'paused') <> (s.key = 'aguardando_cliente')
           or s.is_terminal <> (s.key in ('fechado', 'cancelado'))
     ) then
    raise exception 'TICKETS: ticket_statuses diverge de tickets_sla_clock_check/closed_at_check';
  end if;
  if exists (
    select 1 from public.ticket_status_transitions tr
      join public.ticket_statuses s on s.key = tr.from_status
     where s.is_terminal
  ) then
    raise exception 'TICKETS: status terminal com saída';
  end if;
  select pg_catalog.array_agg(tr.to_status order by tr.to_status) into v_to
    from public.ticket_status_transitions tr where tr.from_status = 'resolvido';
  if v_to is distinct from array['em_atendimento', 'fechado'] then
    raise exception 'TICKETS: resolvido só reabre (em_atendimento) ou fecha';
  end if;
  if exists (
    select 1 from public.ticket_status_transitions tr
     where (tr.to_status = 'fechado' and tr.from_status <> 'resolvido')
        or (tr.to_status = 'cancelado' and tr.from_status = 'resolvido')
  ) then
    raise exception 'TICKETS: fechado vem só de resolvido e cancelado nunca de resolvido (tickets_resolved_at_check)';
  end if;
  -- ticket_apply_take_over e a retomada por inbound dependem destas arestas.
  if (select pg_catalog.count(*) from public.ticket_status_transitions tr
       where tr.to_status = 'em_atendimento'
         and tr.from_status in ('novo', 'em_triagem', 'aguardando_cliente')) <> 3 then
    raise exception 'TICKETS: faltam novo/em_triagem/aguardando_cliente → em_atendimento';
  end if;

  if to_regclass('storage.buckets') is not null then
    if not exists (select 1 from storage.buckets b where b.id = 'ticket-attachments' and not b.public) then
      raise exception 'TICKETS: ticket-attachments ausente ou público';
    end if;
    if (select b.allowed_mime_types from storage.buckets b where b.id = 'ticket-attachments')
       is distinct from (select b.allowed_mime_types from storage.buckets b where b.id = 'chat-media') then
      raise exception 'TICKETS: ticket-attachments com lista de tipos diferente de chat-media';
    end if;
  end if;
end
$$;

-- ============================================================================
-- 15. Catálogo
-- ============================================================================
comment on table public.tickets is
  'Chamado. Escrito só pelas RPCs (create_ticket, ticket_update, ticket_transition, ticket_assign, ticket_set_active, ticket_take_over). Nunca apagado.';
comment on column public.tickets.number is 'Protocolo (exibido como <ticketPrefix>-<number>, src/config/site.ts).';
comment on column public.tickets.version is 'Concorrência otimista: sobe só em coluna de negócio (guard_ticket_update).';
comment on column public.tickets.sla_paused_at is
  'Instante em que o relógio de SOLUÇÃO parou (status paused ou stopped). Nulo ⇔ status running.';
comment on column public.tickets.sla_paused_seconds is
  'Segundos parados já somados ao prazo de solução (resolution_due_at = created_at + minutos + isto).';
comment on column public.tickets.first_responded_at is
  '1ª mensagem humana ACEITA pelo provedor (agent, não nota), no instante do aceite e nunca antes da abertura.';
comment on column public.tickets.idempotency_key is
  'Idempotência por ator (usuário ou token): mesma chave + mesma conversa devolve o mesmo ticket.';
comment on column public.tickets.first_response_breached_at is 'Carimbo do sla_sweep (Fase 6). A tela calcula o SLA na leitura.';
comment on column public.tickets.resolution_breached_at is 'Carimbo do sla_sweep (Fase 6). A tela calcula o SLA na leitura.';
comment on column public.chat_conversations.active_ticket_id is
  'Ticket em foco (mesma conversa, não terminal). Muda só pelas RPCs de ticket.';
comment on column public.chat_messages.ticket_id is
  'Carimbado no INSERT com o foco da conversa (stamp_chat_message_ticket); o valor do app é ignorado.';
comment on table public.ticket_status_history is 'Toda mudança de status, com ator. Append-only (fonte das métricas da Fase 9).';
comment on table public.ticket_events is 'Trilha do ticket fora do status. Append-only; event_key não nulo é idempotente.';
comment on table public.ticket_status_transitions is 'Matriz fixa. Fora dela: INVALID_TRANSITION com os destinos permitidos.';
comment on table public.sla_policies is 'Minutos por prioridade, 24/7. Editar vale para tickets NOVOS (snapshot).';
comment on table public.ticket_attachments is 'Anexo no bucket privado ticket-attachments (tickets/<ticket>/<uuid>). Sem URL: sai por URL assinada curta.';
comment on view public.ticket_queue is
  'Tickets com SLA calculado na leitura (sla_breached, sla_at_risk, next_due_at). security_invoker; só service_role. Mesma regra de src/features/tickets/lib/sla.ts.';

notify pgrst, 'reload schema';

select public.assert_security_baseline();
