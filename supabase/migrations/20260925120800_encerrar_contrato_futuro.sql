-- ============================================================================
-- Fase 3 · Encerrar sem data um contrato que ainda não começou.
--
-- Achado nos testes da Fase 3: set_support_contract_status usava
-- coalesce(p_ends_on, hoje em SP) como término. Num contrato com início no
-- futuro, "hoje" fica ANTES do início e o encerramento falhava com
-- support_contracts_term_check — "o término não pode ser antes do início",
-- para uma data que o usuário nem escolheu.
--
-- O término padrão passa a ser o MAIOR entre hoje e o início. Término
-- informado explicitamente continua valendo como veio (e o check continua
-- recusando um término antes do início).
--
-- CREATE OR REPLACE preserva os privilégios (EXECUTE só do service_role).
-- Depende de 20260925120700_cadastros.sql.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.set_support_contract_status(uuid,uuid,text,date)') is null then
    raise exception 'ENCERRAR: aplique 20260925120700_cadastros antes';
  end if;
end
$$;

create or replace function public.set_support_contract_status(
  p_actor_id    uuid,
  p_contract_id uuid,
  p_status      text,
  p_ends_on     date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_ends_on date;
begin
  perform public.require_active_admin(p_actor_id);

  if p_status is null or p_status not in ('ativo', 'suspenso', 'encerrado') then
    raise exception 'INVALID_STATUS';
  end if;

  select c.status, c.ends_on
    into v_status, v_ends_on
    from public.support_contracts c
   where c.id = p_contract_id
     for update;
  if not found then
    raise exception 'CONTRACT_NOT_FOUND';
  end if;
  if v_status = 'encerrado' then
    raise exception 'CONTRACT_CLOSED';
  end if;
  if v_status = p_status then
    return pg_catalog.jsonb_build_object('status', v_status, 'ends_on', v_ends_on, 'changed', false);
  end if;

  update public.support_contracts c
     set status  = p_status,
         ends_on = case
                     when p_status = 'encerrado'
                       then coalesce(
                              p_ends_on,
                              greatest(
                                (pg_catalog.now() at time zone 'America/Sao_Paulo')::date,
                                c.starts_on
                              )
                            )
                     else c.ends_on
                   end
   where c.id = p_contract_id
  returning c.status, c.ends_on into v_status, v_ends_on;

  return pg_catalog.jsonb_build_object('status', v_status, 'ends_on', v_ends_on, 'changed', true);
end;
$$;

comment on function public.set_support_contract_status(uuid, uuid, text, date) is
  'Única porta de mudança de status. encerrado é terminal (data padrão: o maior entre hoje em SP e o início).';

select public.assert_security_baseline();
