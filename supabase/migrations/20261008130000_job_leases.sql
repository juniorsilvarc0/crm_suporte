-- ============================================================================
--   20261008130000_job_leases.sql  —  Fase 6: lease de jobs do worker
--
--   O worker (RUN_JOBS) roda em CADA réplica. Para jobs em TS que fazem várias
--   chamadas (reconciliar a TCBX, purgar logs) não dá para usar o advisory lock
--   transacional do sla_sweep (uma SQL só). Aqui: um lease por job — job_claim
--   pega o lock por N segundos (quem não pega pula o ciclo) e devolve o CURSOR
--   compartilhado do job (ex.: até onde a reconciliação chegou), para a leva
--   avançar de forma linear entre réplicas, sem repetir.
--
--   Escrita só pelas RPCs (security definer, dona = migrations); service_role só
--   EXECUTE — nada toca a tabela direto.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'JOB_LEASES: aplique a fundação antes';
  end if;
end
$$;

create table if not exists public.job_leases (
  name         text primary key,
  locked_until timestamptz not null default pg_catalog.to_timestamp(0),
  job_cursor   text,
  updated_at   timestamptz not null default now(),
  constraint job_leases_name_check
    check (pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 60)
);

comment on table public.job_leases is
  'Lease de execução única de job do worker (Fase 6). job_claim pega o lock e devolve o cursor; job_cursor_set salva o progresso. Escrita só pelas RPCs.';

alter table public.job_leases enable row level security;
-- Nenhum grant direto: a tabela é escrita só pelas RPCs (dona = migrations).
revoke all on table public.job_leases from public, anon, authenticated, service_role;

-- Pega o lease de p_name por p_seconds. Devolve {claimed, cursor}. UPDATE
-- atômico: entre réplicas concorrentes, só uma leva v_rows > 0.
create or replace function public.job_claim(p_name text, p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows   integer;
  v_cursor text;
begin
  insert into public.job_leases (name, locked_until)
    values (p_name, pg_catalog.to_timestamp(0))
    on conflict (name) do nothing;

  update public.job_leases
     set locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_seconds),
         updated_at   = pg_catalog.now()
   where name = p_name
     and locked_until <= pg_catalog.now()
  returning job_cursor into v_cursor;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return pg_catalog.jsonb_build_object('claimed', false);
  end if;
  return pg_catalog.jsonb_build_object('claimed', true, 'cursor', v_cursor);
end;
$$;

comment on function public.job_claim(text, integer) is
  'Pega o lease do job por p_seconds. {claimed:true,cursor} = pode rodar; {claimed:false} = outra réplica está. Único caminho para tomar o lease.';

-- Salva o cursor do job (progresso da leva). Só faz sentido com o lease na mão.
create or replace function public.job_cursor_set(p_name text, p_cursor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.job_leases
     set job_cursor = p_cursor, updated_at = pg_catalog.now()
   where name = p_name;
end;
$$;

comment on function public.job_cursor_set(text, text) is
  'Salva o cursor/progresso do job no lease (ex.: até onde a reconciliação da TCBX chegou).';

revoke all on function public.job_claim(text, integer) from public, anon, authenticated;
grant execute on function public.job_claim(text, integer) to service_role;
revoke all on function public.job_cursor_set(text, text) from public, anon, authenticated;
grant execute on function public.job_cursor_set(text, text) to service_role;

notify pgrst, 'reload schema';

select public.assert_security_baseline();
