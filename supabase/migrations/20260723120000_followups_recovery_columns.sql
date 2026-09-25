-- ============================================================================
-- followups: colunas da régua de recuperação de leads.
--
-- O agente externo (n8n/AgentForge) é quem DISPARA a retomada (48h/5d/10d) no
-- WhatsApp; o CRM só REGISTRA o histórico. A cada toque, e quando o lead
-- responde, o agente chama POST /api/webhooks/n8n/followup com DOIS eventos de
-- MESMA idempotency_key: (1) envio e (2) resposta.
--
-- Até aqui esses campos eram achatados dentro do texto de `message`
-- ("[48h] ... (respondeu) (recuperado)") e `replied_at` era descartado. Agora
-- viram colunas próprias, para medir a taxa de recuperação de forma estruturada.
-- Idempotente e não-destrutiva: pode rodar mais de uma vez com segurança.
-- ============================================================================

alter table public.followups add column if not exists step        text;
alter table public.followups add column if not exists replied     boolean not null default false;
alter table public.followups add column if not exists replied_at  timestamptz;
alter table public.followups add column if not exists recovered   boolean not null default false;

-- Acelera a agregação do dashboard (enviados/recuperados por período via
-- sent_at). Parcial: só as linhas efetivamente enviadas entram no índice.
create index if not exists followups_recovery_idx
  on public.followups (sent_at)
  where status = 'enviado';
