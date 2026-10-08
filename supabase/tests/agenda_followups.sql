-- ============================================================================
-- Testes de agenda + follow-ups (20261008160000 · Fase 7). Rodados por
-- scripts/db-local-test.sh, em ROLLBACK. O setup (empresa, técnico, contato,
-- conversa e um ticket real) roda como postgres; o CRUD e os checks rodam como
-- service_role (o app). Os ON DELETE são conferidos no catálogo (sem depender de
-- guard de delete das tabelas pai).
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role;
create temp table ids (cust uuid, tech uuid, contact uuid, conv uuid, ticket uuid) on commit drop;
grant all on ids to service_role;

-- Setup (postgres): os pais dos vínculos e o ticket do follow-up.
do $$
declare v_cust uuid; v_tech uuid; v_contact uuid; v_conv uuid; v_ticket uuid;
begin
  insert into public.customers (legal_name) values ('Empresa Agenda Ltda') returning id into v_cust;
  insert into public.app_users (email, name, password_hash, role)
    values ('tecnico.agenda@local', 'Técnico Agenda', 'x', 'admin') returning id into v_tech;
  insert into public.contacts (phone, normalized_phone)
    values ('5511990000000', '11990000000') returning id into v_contact;
  insert into public.chat_conversations (contact_id, external_id)
    values (v_contact, '5511990000000') returning id into v_conv;
  v_ticket := (public.create_ticket(
    p_conversation_id => v_conv, p_title => 'Ticket da agenda', p_actor_user_id => v_tech
  ) #>> '{ticket,id}')::uuid;
  insert into ids values (v_cust, v_tech, v_contact, v_conv, v_ticket);
end
$$;

-- ── appointments (como service_role) ────────────────────────────────────────
set role service_role;
do $$
declare v_app uuid; v_cust uuid; v_tech uuid; v_contact uuid; v_ticket uuid;
begin
  select cust, tech, contact, ticket into v_cust, v_tech, v_contact, v_ticket from ids;

  insert into public.appointments (kind, ticket_id, customer_id, contact_id, assignee_id, scheduled_at, status)
    values ('visita_tecnica', v_ticket, v_cust, v_contact, v_tech, pg_catalog.now(), 'agendado')
    returning id into v_app;
  insert into r values (v_app is not null, 'appointments: service_role insere com os vínculos', v_app::text);

  update public.appointments set status = 'realizado' where id = v_app;
  insert into r values (true, 'appointments: service_role atualiza', null);
  delete from public.appointments where id = v_app;
  insert into r values (true, 'appointments: service_role apaga', null);

  begin
    insert into public.appointments (kind, scheduled_at) values ('consulta', pg_catalog.now());
    insert into r values (false, 'appointments: kind inválido recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'appointments: kind inválido recusado', 'ok'); end;

  begin
    insert into public.appointments (kind, scheduled_at, status) values ('treinamento', pg_catalog.now(), 'pendente');
    insert into r values (false, 'appointments: status inválido recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'appointments: status inválido recusado', 'ok'); end;

  begin
    insert into public.appointments (kind, scheduled_at, duration_min) values ('treinamento', pg_catalog.now(), 0);
    insert into r values (false, 'appointments: duração <= 0 recusada', 'aceitou');
  exception when check_violation then insert into r values (true, 'appointments: duração <= 0 recusada', 'ok'); end;
end
$$;
reset role;

-- ── followups (como service_role) ───────────────────────────────────────────
set role service_role;
do $$
declare v_f uuid; v_ticket uuid;
begin
  select ticket into v_ticket from ids;

  insert into public.followups (ticket_id, due_at) values (v_ticket, pg_catalog.now() + interval '1 day')
    returning id into v_f;
  insert into r values (v_f is not null, 'followups: service_role insere pendente', v_f::text);

  begin
    insert into public.followups (ticket_id, due_at, status) values (v_ticket, pg_catalog.now(), 'concluido');
    insert into r values (false, 'followups: concluído sem done_at recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'followups: concluído sem done_at recusado', 'ok'); end;

  begin
    insert into public.followups (ticket_id, due_at, done_at) values (v_ticket, pg_catalog.now(), pg_catalog.now());
    insert into r values (false, 'followups: pendente com done_at recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'followups: pendente com done_at recusado', 'ok'); end;

  update public.followups set status = 'concluido', done_at = pg_catalog.now() where id = v_f;
  insert into r values (
    (select status = 'concluido' and done_at is not null from public.followups where id = v_f),
    'followups: concluir com done_at ok', null);

  begin
    insert into public.followups (ticket_id, due_at, kind) values (v_ticket, pg_catalog.now(), 'nao_existe');
    insert into r values (false, 'followups: kind inválido recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'followups: kind inválido recusado', 'ok'); end;

  begin
    insert into public.followups (ticket_id, due_at) values (null, pg_catalog.now());
    insert into r values (false, 'followups: ticket_id obrigatório', 'aceitou');
  exception when not_null_violation then insert into r values (true, 'followups: ticket_id obrigatório', 'ok'); end;
end
$$;
reset role;

-- ── agenda_blocks (como service_role) ───────────────────────────────────────
set role service_role;
do $$
declare v_b uuid; v_tech uuid;
begin
  select tech into v_tech from ids;

  insert into public.agenda_blocks (starts_at, ends_at, assignee_id, reason)
    values (pg_catalog.now(), pg_catalog.now() + interval '2 hours', v_tech, 'Folga')
    returning id into v_b;
  insert into r values (v_b is not null, 'agenda_blocks: service_role insere', v_b::text);

  begin
    insert into public.agenda_blocks (starts_at, ends_at)
      values (pg_catalog.now(), pg_catalog.now() - interval '1 hour');
    insert into r values (false, 'agenda_blocks: range inválido (fim <= início) recusado', 'aceitou');
  exception when check_violation then insert into r values (true, 'agenda_blocks: range inválido (fim <= início) recusado', 'ok'); end;
end
$$;
reset role;

-- ── ON DELETE no catálogo (n = SET NULL, c = CASCADE) ────────────────────────
insert into r values (
  (select confdeltype from pg_constraint where conname = 'appointments_customer_id_fkey') = 'n',
  'appointments.customer_id é ON DELETE SET NULL', null);
insert into r values (
  (select confdeltype from pg_constraint where conname = 'appointments_ticket_id_fkey') = 'n',
  'appointments.ticket_id é ON DELETE SET NULL', null);
insert into r values (
  (select confdeltype from pg_constraint where conname = 'followups_ticket_id_fkey') = 'c',
  'followups.ticket_id é ON DELETE CASCADE', null);

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select pg_catalog.string_agg(teste, '; ' order by teste) into v_falhas from r where ok is not true;
  if v_falhas is not null then
    raise exception 'testes de agenda/follow-ups falharam: %', v_falhas;
  end if;
  raise notice 'testes de agenda/follow-ups: % caso(s), todos ok', (select pg_catalog.count(*) from r);
end
$$;

rollback;
