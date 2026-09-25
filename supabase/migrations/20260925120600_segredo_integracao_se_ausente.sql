-- ============================================================================
-- CRM Suporte — segredo da integração "cria se ausente", atômico.
--
-- Achado da revisão da Fase 2: o `persist` da Conexão lia o segredo do
-- webhook, gerava um valor e gravava, em três passos. Duas conexões
-- simultâneas (duas abas, dois admins) geravam dois segredos: o Vault ficava
-- com o do último `set`, a uazapi com o do último registro do webhook, e todo
-- webhook passava a responder 401 em silêncio.
--
-- `ensure_chat_integration_secret` trava a linha da integração, devolve o
-- segredo que já existe ou grava o candidato, e devolve o valor EFETIVO. Quem
-- registra o webhook usa esse valor, nunca o que gerou localmente.
--
-- Depende de 20260925120400_chat.sql (set/get_chat_integration_secret).
-- ============================================================================

do $$
begin
  if pg_catalog.to_regprocedure('public.set_chat_integration_secret(uuid,text,text)') is null
     or pg_catalog.to_regprocedure('public.get_chat_integration_secret(uuid,text)') is null then
    raise exception 'segredo se ausente: aplique 20260925120400_chat antes (set/get_chat_integration_secret)';
  end if;
end
$$;

create or replace function public.ensure_chat_integration_secret(
  p_integration_id uuid,
  p_kind text,
  p_candidate text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  -- A mesma trava de set_chat_integration_secret: a segunda chamada espera a
  -- primeira terminar e, no comando seguinte (snapshot novo, read committed),
  -- enxerga o segredo que ela gravou.
  perform 1
    from public.chat_integrations i
   where i.id = p_integration_id
     for update;
  if not found then
    raise exception 'chat_integration_not_found'
      using errcode = 'P0002';
  end if;

  v_current := public.get_chat_integration_secret(p_integration_id, p_kind);
  if v_current is not null and pg_catalog.length(v_current) > 0 then
    return v_current;
  end if;

  -- Valida o tipo e o valor (e recria se o id apontar para segredo sumido).
  perform public.set_chat_integration_secret(p_integration_id, p_kind, p_candidate);
  return p_candidate;
end;
$$;

revoke all on function public.ensure_chat_integration_secret(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ensure_chat_integration_secret(uuid, text, text)
  to service_role;

comment on function public.ensure_chat_integration_secret(uuid, text, text) is
  'Devolve o segredo da integração; se não existe, grava o candidato. Atômico sob a trava da linha: duas chamadas simultâneas devolvem o MESMO valor.';

select public.assert_security_baseline();
