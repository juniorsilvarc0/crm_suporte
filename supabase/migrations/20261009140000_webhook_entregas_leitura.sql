-- ============================================================================
--   20261009140000_webhook_entregas_leitura.sql  —  Fase 6c-2: ler as entregas
--
--   A tela de Webhooks (6c-3) lista as entregas — status, tentativas, último
--   HTTP e erro — direto do `event_outbox`. Até aqui o service_role só tinha
--   EXECUTE nas RPCs da fila; esta migration dá SELECT por coluna, SEM a lease
--   (`lease_token`/`lease_owner`/`lease_expires_at`): ler não serve para
--   finalizar uma entrega alheia. A escrita continua só pelas RPCs.
--
--   Aditiva e idempotente (GRANT repetido não muda nada).
-- ============================================================================

do $$
begin
  if to_regclass('public.event_outbox') is null
     or to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'WEBHOOK_ENTREGAS_LEITURA: aplique a migration do event_outbox antes';
  end if;
end
$$;

grant select (
  id, kind, event_key, payload, status, attempts, next_attempt_at,
  last_http_status, last_error, created_at, updated_at, delivered_at
) on table public.event_outbox to service_role;

notify pgrst, 'reload schema';

select public.assert_security_baseline();
