-- ============================================================================
--   20261009120000_chat_connection_events.sql  —  Monitor de conexão do WhatsApp
--
--   Em 2026-10-08 a sessão do WhatsApp caiu às 16:06 (Brasília) e ninguém soube
--   por 15 horas: o CRM não guardava o estado da instância, e o webhook só
--   assina eventos de mensagem. Esta tabela é o histórico do estado da conexão:
--   uma linha por MUDANÇA (não por consulta), com o motivo quando o provedor
--   informar. Quem escreve é o worker (consulta o status da instância a cada
--   poucos minutos — leitura, não mexe na sessão).
--
--   Só inserção: é registro (como `contact_events`). Escrita só pelo servidor
--   (service_role); RLS ligada e NENHUMA policy. Aditiva e idempotente.
-- ============================================================================

do $$
begin
  if to_regclass('public.chat_integrations') is null
     or to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'CHAT_CONNECTION_EVENTS: aplique as migrations de fundação e do chat antes';
  end if;
end
$$;

create table if not exists public.chat_connection_events (
  id             uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  -- O mesmo vocabulário do painel de Conexão (getUazapiStatus): conectado,
  -- conectando (esperando o QR), desconectado, ou desconhecido (o provedor não
  -- respondeu — não dá para afirmar que a sessão caiu).
  state          text not null,
  reason         text,
  -- 'poll' = consulta do worker; 'webhook' fica reservado para o evento de
  -- conexão do provedor, quando ele for assinado.
  source         text not null,
  occurred_at    timestamptz not null default now(),
  constraint chat_connection_events_integration_id_fkey
    foreign key (integration_id) references public.chat_integrations (id) on delete cascade,
  constraint chat_connection_events_state_check
    check (state in ('open', 'connecting', 'close', 'unknown')),
  constraint chat_connection_events_reason_check
    check (reason is null or (pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 300)),
  constraint chat_connection_events_source_check
    check (source in ('poll', 'webhook'))
);

comment on table public.chat_connection_events is
  'Histórico do estado da conexão do WhatsApp: uma linha por mudança (worker). Só inserção, só pelo servidor.';

-- O estado atual é a linha mais nova da integração; o histórico, as últimas.
create index if not exists chat_connection_events_integration_occurred_idx
  on public.chat_connection_events (integration_id, occurred_at desc);

alter table public.chat_connection_events enable row level security;

revoke all on table public.chat_connection_events from public, anon, authenticated, service_role;
-- Registro: o servidor lê e acrescenta; não altera nem apaga (o ON DELETE
-- CASCADE da integração é do dono da tabela, não do service_role).
grant select, insert on table public.chat_connection_events to service_role;

-- O PostgREST guarda o schema em cache; sem o reload ele segue com o mapa antigo.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
