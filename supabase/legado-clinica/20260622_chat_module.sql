-- Chat module schema

create extension if not exists "pgcrypto";

-- Integrations: one row per WhatsApp account / provider connection
create table if not exists chat_integrations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  provider        text not null check (provider in ('evolution', 'uazapi', 'meta')),
  phone_number    text,
  config          jsonb not null default '{}',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Conversations: one row per unique contact per integration
create table if not exists chat_conversations (
  id                    uuid primary key default gen_random_uuid(),
  integration_id        uuid references chat_integrations(id) on delete set null,
  external_id           text not null,
  contact_name          text,
  contact_phone         text,
  contact_avatar_url    text,
  status                text not null default 'bot' check (status in ('bot', 'human', 'resolved')),
  unread_count          integer not null default 0,
  last_message_at       timestamptz,
  last_message_preview  text,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (integration_id, external_id)
);

-- Messages
create table if not exists chat_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references chat_conversations(id) on delete cascade,
  external_id       text,
  direction         text not null check (direction in ('inbound', 'outbound')),
  type              text not null default 'text' check (type in (
    'text', 'image', 'audio', 'video', 'document', 'sticker', 'contact', 'template', 'note'
  )),
  content           text,
  media_url         text,
  media_mime_type   text,
  quoted_message_id uuid references chat_messages(id) on delete set null,
  delivery_status   text not null default 'pending' check (delivery_status in (
    'pending', 'sent', 'delivered', 'read', 'failed'
  )),
  sent_by_user_id   uuid,
  is_deleted        boolean not null default false,
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  unique (conversation_id, external_id)
);

-- Quick replies
create table if not exists chat_quick_replies (
  id         uuid primary key default gen_random_uuid(),
  shortcut   text not null unique,
  content    text not null,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_chat_conversations_integration
  on chat_conversations(integration_id);
create index if not exists idx_chat_conversations_status
  on chat_conversations(status);
create index if not exists idx_chat_conversations_last_message_at
  on chat_conversations(last_message_at desc);
create index if not exists idx_chat_messages_conversation_id
  on chat_messages(conversation_id);
create index if not exists idx_chat_messages_created_at
  on chat_messages(created_at);

-- Enable Realtime for Supabase Postgres Changes
alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table chat_conversations;

-- RLS: disable for service role usage (enable per project security requirements)
alter table chat_integrations enable row level security;
alter table chat_conversations enable row level security;
alter table chat_messages enable row level security;
alter table chat_quick_replies enable row level security;

-- Service role bypass (admin client uses service role key — full access)
create policy "service_role_all_integrations"
  on chat_integrations for all to service_role using (true) with check (true);
create policy "service_role_all_conversations"
  on chat_conversations for all to service_role using (true) with check (true);
create policy "service_role_all_messages"
  on chat_messages for all to service_role using (true) with check (true);
create policy "service_role_all_quick_replies"
  on chat_quick_replies for all to service_role using (true) with check (true);
