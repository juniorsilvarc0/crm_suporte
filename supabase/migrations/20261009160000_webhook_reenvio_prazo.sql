-- ============================================================================
--   20261009160000_webhook_reenvio_prazo.sql  —  o reenvio manual recomeça o prazo
--
--   O `outbox_claim` mata a entrega criada há mais de `max_age` (3 dias para os
--   webhooks). O `outbox_requeue` (20261009130000) zerava as tentativas, mas não
--   o `created_at`: uma entrega que esgotou pelo prazo (destino fora do ar por
--   mais de 3 dias), ou reenviada depois do 3º dia, voltava à fila e morria de
--   novo no claim seguinte, sem sair. Agora o reenvio recomeça o prazo. A hora
--   do fato continua no corpo (`occurred_at`); `created_at` passa a ser quando a
--   entrega entrou (de novo) na fila.
--
--   Só troca o corpo da função (mesma assinatura). Idempotente.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.outbox_requeue(uuid)') is null
     or to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'WEBHOOK_REENVIO_PRAZO: aplique a migration dos webhooks de saída antes';
  end if;
end
$$;

-- Só `webhook` em `dead_letter`: volta para a fila com as tentativas zeradas e
-- o prazo recomeçado. O relay não entra (a janela útil da mensagem é de 2
-- minutos). Devolve se reenfileirou.
create or replace function public.outbox_requeue(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_outbox o
     set status = 'pending', attempts = 0, next_attempt_at = pg_catalog.now(),
         created_at = pg_catalog.now(),
         lease_token = null, lease_owner = null, lease_expires_at = null,
         last_error = null, updated_at = pg_catalog.now()
   where o.id = p_id and o.kind = 'webhook' and o.status = 'dead_letter';
  return found;
end;
$$;

-- O REPLACE mantém os privilégios; repetidos aqui para a função nunca ficar
-- aberta por engano (EXECUTE nasce para PUBLIC).
revoke all on function public.outbox_requeue(uuid) from public, anon, authenticated;
grant execute on function public.outbox_requeue(uuid) to service_role;

select public.assert_security_baseline();
