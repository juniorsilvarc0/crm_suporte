-- ============================================================================
--   20261008120000_sla_sweep.sql  —  Fase 6a: SLA automático
--
--   Uma função que o worker (src/instrumentation.ts, RUN_JOBS) chama a cada ~60s:
--     1. carimba first_response_breached_at / resolution_breached_at UMA vez por
--        ticket, no MESMO critério da view ticket_queue (fila do Início/lista);
--     2. fecha sozinho (resolvido → fechado) o ticket resolvido há mais de 72h.
--
--   ⚠️ service_role NÃO escreve em `tickets` (assert local §14 de _tickets); por
--   isso `sla_sweep` é SECURITY DEFINER (dona = papel das migrations) e o
--   service_role recebe só EXECUTE. O fechamento NÃO passa pelo ticket_transition
--   público (ele recusa ator "sistema" e exige versão): chama o helper interno
--   public.ticket_apply_transition com actor_type='system', replicando o
--   travamento (conversa FOR UPDATE antes do ticket FOR NO KEY UPDATE).
--
--   Execução única entre réplicas: advisory lock transacional — quem não pega
--   pula o ciclo (o worker roda em cada réplica; só uma varre por vez).
-- ============================================================================

do $$
begin
  if to_regprocedure('public.ticket_apply_transition(public.tickets, text, text, uuid, uuid, text)') is null
     or to_regclass('public.tickets') is null
     or to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'SLA_SWEEP: aplique as migrations de tickets/fundação antes';
  end if;
end
$$;

create or replace function public.sla_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fr      integer := 0;
  v_res     integer := 0;
  v_closed  integer := 0;
  v_id      uuid;
  v_conv_id uuid;
  v_t       public.tickets%rowtype;
begin
  -- Só uma réplica varre por vez: quem não pega o lock pula este ciclo.
  if not pg_catalog.pg_try_advisory_xact_lock(872026) then
    return pg_catalog.jsonb_build_object('skipped', true);
  end if;

  -- 1. Estouro da 1ª resposta (uma vez por ticket). Critério = view ticket_queue
  --    (20260926130000, lateral b): sem resposta, status não-parado, vencido.
  update public.tickets t
     set first_response_breached_at = pg_catalog.now()
    from public.ticket_statuses s
   where s.key = t.status
     and t.first_response_breached_at is null
     and t.first_responded_at is null
     and s.sla_mode <> 'stopped'
     and t.first_response_due_at <= pg_catalog.now();
  get diagnostics v_fr = row_count;

  -- 2. Estouro da resolução. Pausado (aguardando_cliente) congela em
  --    sla_paused_at — o mesmo coalesce da view, não now() cru.
  update public.tickets t
     set resolution_breached_at = pg_catalog.now()
    from public.ticket_statuses s
   where s.key = t.status
     and t.resolution_breached_at is null
     and s.sla_mode <> 'stopped'
     and t.resolution_due_at <= coalesce(t.sla_paused_at, pg_catalog.now());
  get diagnostics v_res = row_count;

  -- 3. Fecha sozinho o resolvido há mais de 72h (resolvido → fechado, terminal).
  --    Em levas (teto 200): o ciclo seguinte pega o resto.
  for v_id, v_conv_id in
    select t.id, t.conversation_id
      from public.tickets t
     where t.status = 'resolvido'
       and t.resolved_at <= pg_catalog.now() - interval '72 hours'
     order by t.resolved_at
     limit 200
  loop
    -- Destino terminal pode tirar o ticket do foco: conversa ANTES do ticket
    -- (ordem de ticket_transition). conversa nula → o perform não trava nada.
    perform 1 from public.chat_conversations c where c.id = v_conv_id for update;
    select * into v_t from public.tickets t where t.id = v_id for no key update;
    -- Recheca sob a trava: pode ter sido reaberto/fechado no meio.
    if v_t.status = 'resolvido'
       and v_t.resolved_at <= pg_catalog.now() - interval '72 hours' then
      perform public.ticket_apply_transition(
        v_t, 'fechado', 'system', null, null, 'Fechado automaticamente após 72h resolvido');
      v_closed := v_closed + 1;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'first_response', v_fr, 'resolution', v_res, 'closed', v_closed);
end;
$$;

comment on function public.sla_sweep() is
  'Fase 6a: carimba *_breached_at (critério da view ticket_queue) e fecha o resolvido após 72h (ator system). SECURITY DEFINER; service_role só EXECUTE. O worker (RUN_JOBS) chama a cada ~60s.';

-- EXECUTE nasce para PUBLIC; anon herda dali. Só o service_role (o worker).
revoke all on function public.sla_sweep() from public, anon, authenticated;
grant execute on function public.sla_sweep() to service_role;

-- O PostgREST guarda o schema em cache; sem o reload ele não enxerga a RPC nova.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
