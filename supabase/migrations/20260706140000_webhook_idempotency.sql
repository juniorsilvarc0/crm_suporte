-- ============================================================================
-- Idempotência dos webhooks de agendamento e follow-up.
-- O n8n reenvia a entrega em timeout/5xx; o insert cru duplicava a linha
-- (agendamento/follow-up duplicado na agenda). Uma chave de idempotência única
-- (quando enviada no payload) permite upsert sem duplicar em retries.
-- ============================================================================

alter table public.appointments add column if not exists idempotency_key text;
alter table public.followups    add column if not exists idempotency_key text;

-- Índice NÃO-parcial: no Postgres NULLs são distintos, então várias linhas sem
-- idempotency_key coexistem; e o ON CONFLICT (idempotency_key) do upsert
-- (supabase-js) só consegue inferir um índice NÃO-parcial.
create unique index if not exists appointments_idempotency_key_uidx
  on public.appointments (idempotency_key);

create unique index if not exists followups_idempotency_key_uidx
  on public.followups (idempotency_key);
