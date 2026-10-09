-- ============================================================================
--   20261009170000_outbox_expurgo.sql  —  retenção da fila de entrega (30 dias)
--
--   O `event_outbox` não tinha expurgo. Cada mensagem recebida em conversa
--   `bot` grava uma linha `relay` com o envelope da mensagem (o texto do
--   cliente), e as entregas de webhook levam ids e o que mudou: tudo ficava
--   para sempre, duplicando o chat. Decisão do dono (2026-10-09): apagar as
--   linhas ENCERRADAS (`sent`, `skipped`, `dead_letter`) cuja última mudança
--   passou de 30 dias, no job de manutenção (a cada hora), como já se faz com
--   o `integration_logs` (90 dias, D9). O que ainda vai sair (`pending`,
--   `processing`, `retry`) nunca é apagado.
--
--   Aditiva e idempotente (função nova).
-- ============================================================================

do $$
begin
  if to_regclass('public.event_outbox') is null
     or to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'OUTBOX_EXPURGO: aplique a migration do event_outbox antes';
  end if;
end
$$;

-- A retenção mínima é a própria decisão (30 dias): ninguém encurta por engano.
create or replace function public.outbox_purge(p_older_than interval default interval '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_older_than is null or p_older_than < interval '30 days' then
    raise exception 'INVALID_RETENTION' using errcode = '22023',
      detail = 'Retenção mínima de 30 dias para a fila de entrega.';
  end if;
  delete from public.event_outbox o
   where o.status in ('sent', 'skipped', 'dead_letter')
     and o.updated_at < pg_catalog.now() - p_older_than;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.outbox_purge(interval) is
  'Apaga do event_outbox as linhas encerradas (sent, skipped, dead_letter) sem mudança há mais de p_older_than (mínimo 30 dias). Job de manutenção.';

revoke all on function public.outbox_purge(interval) from public, anon, authenticated;
grant execute on function public.outbox_purge(interval) to service_role;

select public.assert_security_baseline();
