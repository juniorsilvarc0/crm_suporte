-- ============================================================================
-- Testes de cadastros (20260925120700): empresa, fila, plano, contrato de
-- suporte e o vínculo contato → empresa. Rodados por scripts/db-local-test.sh;
-- tudo em ROLLBACK.
--
-- O preparo roda como postgres; os casos do app, como service_role. Volta a
-- postgres só o que o app não faz nesta fase: arquivar fila e plano (o
-- service_role não tem UPDATE neles).
--
-- Não coberto aqui, porque exige duas sessões: as corridas (dois contratos ao
-- mesmo tempo; contrato × arquivar a empresa). A prova é manual, com duas
-- sessões psql, e o resultado vai para o PROGRESS.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
-- Ids que atravessam os blocos: cada troca de papel abre um bloco novo.
create temp table ids (k text primary key, id uuid not null) on commit drop;
grant all on r, ids to service_role;

-- Isola dos dados de dev (volta no ROLLBACK): libera os CNPJs e o nome de fila
-- que os casos usam, se alguém os cadastrou no banco local.
update public.customers set cnpj = null
 where cnpj in ('11222333000181', '12ABC34501DE35') and archived_at is null;
update public.products set archived_at = now()
 where lower(btrim(name)) = 'erp' and archived_at is null;

-- Preparo: dois admins (o segundo desativado), um member e um contato.
insert into ids
select 'admin', id from public.create_app_user('cad-admin@x.test', 'Admin Cadastros', '12345678', 'admin', 'slate');
insert into ids
select 'inactive_admin', id from public.create_app_user('cad-inativo@x.test', 'Admin Inativo', '12345678', 'admin', 'slate');
update public.app_users set is_active = false where id = (select id from ids where k = 'inactive_admin');
insert into ids
select 'member', id from public.create_app_user('cad-member@x.test', 'Membro Cadastros', '12345678', 'member', 'slate');
insert into ids
select 'contact', (public.resolve_contact_identity('5511990000501', 'Contato Cadastros', 'whatsapp', null, false)->>'contactId')::uuid;

set role service_role;

do $$
declare
  v_admin uuid; v_inactive uuid; v_member uuid; v_contact uuid;
  v_a uuid; v_a2 uuid; v_b uuid; v_k uuid; v_x uuid; v_y uuid;
  v_erp uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_plan2 uuid;
  v_k1 uuid; v_k2 uuid; v_x1 uuid; v_id uuid; v_f uuid; v_fk uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_start date := v_today - 30;
  v_d date; v_amount numeric; j jsonb;
  v_c text; v_t text; v_t2 text; v_sql text; v_fail text;
  v_n int; v_n0 int;
begin
  select id into v_admin from ids where k = 'admin';
  select id into v_inactive from ids where k = 'inactive_admin';
  select id into v_member from ids where k = 'member';
  select id into v_contact from ids where k = 'contact';

  -- empresa
  insert into public.customers (legal_name, cnpj, created_by_user_id)
  values ('Empresa Numérica Ltda', '11222333000181', v_admin) returning id into v_a;
  insert into public.customers (legal_name, trade_name, cnpj)
  values ('Padaria S. João Ltda', 'Padaria São João', '12ABC34501DE35') returning id into v_b;
  insert into r values (v_a is not null and v_b is not null, 'C01 CNPJ numérico e alfanumérico entram', '');

  begin
    insert into public.customers (legal_name, cnpj) values ('Com Máscara', '11.222.333/0001-81');
    insert into r values (false, 'C02a CNPJ com máscara barrado', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23514' and v_c = 'customers_cnpj_format_check',
      'C02a CNPJ com máscara barrado', sqlstate || ' ' || v_c);
  end;
  begin
    insert into public.customers (legal_name, cnpj) values ('Minúsculas', '12abc34501de35');
    insert into r values (false, 'C02b CNPJ minúsculo barrado', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23514' and v_c = 'customers_cnpj_format_check',
      'C02b CNPJ minúsculo barrado', sqlstate || ' ' || v_c);
  end;

  begin
    insert into public.customers (legal_name, cnpj) values ('Duplicada', '11222333000181');
    insert into r values (false, 'C03 CNPJ único entre ativas', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23505' and v_c = 'customers_cnpj_active_uidx',
      'C03 CNPJ único entre ativas', sqlstate || ' ' || v_c);
  end;

  update public.customers set archived_at = now() where id = v_a;
  insert into public.customers (legal_name, cnpj) values ('Empresa Numérica Nova', '11222333000181')
  returning id into v_a2;
  insert into r values (v_a2 is not null, 'C04 arquivar libera o CNPJ', '');

  insert into public.customers (legal_name) values ('Sem CNPJ Um'), ('Sem CNPJ Dois');
  get diagnostics v_n = row_count;
  insert into r values (v_n = 2, 'C05 empresas sem CNPJ convivem', v_n::text);

  select search_name into v_t from public.customers where id = v_b;
  insert into r values (v_t = 'padaria sao joao padaria s joao ltda 12abc34501de35', 'C06 search_name', v_t);

  begin
    update public.customers set contract_status = 'ativo' where id = v_b;
    insert into r values (false, 'C07a selo não é escrito pelo app', 'passou');
  exception when others then
    insert into r values (sqlstate = '42501', 'C07a selo não é escrito pelo app', sqlstate || ' ' || sqlerrm);
  end;
  begin
    delete from public.customers where id = v_b;
    insert into r values (false, 'C07b empresa não é apagada', 'passou');
  exception when others then
    insert into r values (sqlstate = '42501', 'C07b empresa não é apagada', sqlstate || ' ' || sqlerrm);
  end;

  -- fila (P01d, arquivar libera o nome, roda no segundo bloco)
  insert into public.products (name) values ('ERP') returning id into v_erp;
  begin
    insert into public.products (name) values (' erp ');
    insert into r values (false, 'P01a fila única sem caixa nem espaço', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23505' and v_c = 'products_name_active_uidx',
      'P01a fila única sem caixa nem espaço', sqlstate || ' ' || v_c);
  end;
  begin
    insert into public.products (name, color) values ('Fila Cor', 'Red');
    insert into r values (false, 'P01b cor fora da paleta', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23514' and v_c = 'products_color_format_check',
      'P01b cor fora da paleta', sqlstate || ' ' || v_c);
  end;
  begin
    update public.products set name = 'ERP 2' where id = v_erp;
    insert into r values (false, 'P01c fila não é editada nesta fase', 'passou');
  exception when others then
    insert into r values (sqlstate = '42501', 'P01c fila não é editada nesta fase', sqlstate || ' ' || sqlerrm);
  end;

  insert into public.products (name) values ('Fila Teste Alfa') returning id into v_p1;
  insert into public.products (name) values ('Fila Teste Beta') returning id into v_p2;
  insert into public.products (name) values ('Fila Teste Gama') returning id into v_p3;

  -- plano
  insert into public.support_plans (name) values ('Plano Teste Ouro');
  insert into public.support_plans (name) values ('Plano Teste Prata') returning id into v_plan2;
  begin
    insert into public.support_plans (name) values (' plano teste ouro ');
    insert into r values (false, 'S01 plano único entre ativos', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23505' and v_c = 'support_plans_name_active_uidx',
      'S01 plano único entre ativos', sqlstate || ' ' || v_c);
  end;

  insert into public.customers (legal_name) values ('Cliente Contrato K') returning id into v_k;
  insert into public.customers (legal_name) values ('Cliente Contrato X') returning id into v_x;
  insert into public.customers (legal_name) values ('Cliente Contrato Y') returning id into v_y;

  -- papel conferido no banco
  begin
    perform public.create_support_contract(v_member, v_k, 'ativo', v_start, 1234.56, 10, array[v_p1]);
    insert into r values (false, 'K01a member não cria contrato', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'FORBIDDEN', 'K01a member não cria contrato', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.create_support_contract(v_inactive, v_k, 'ativo', v_start, 1234.56, 10, array[v_p1]);
    insert into r values (false, 'K01b admin inativo não cria contrato', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'FORBIDDEN', 'K01b admin inativo não cria contrato', sqlstate || ' ' || sqlerrm);
  end;

  -- caminho feliz, dedup e selo
  v_k1 := public.create_support_contract(v_admin, v_k, 'ativo', v_start, 1234.56, 10, array[v_p1, v_p2, v_p1]);
  select count(*) into v_n from public.support_contract_products where contract_id = v_k1;
  select contract_status into v_t from public.customers where id = v_k;
  insert into r values (v_n = 2 and v_t = 'ativo', 'K02 cria com produtos sem repetição e selo ativo',
    v_n || ' produto(s) | ' || coalesce(v_t, '<null>'));

  begin
    perform public.update_support_contract(v_member, v_k1, v_start, 1234.56, 10, array[v_p1]);
    insert into r values (false, 'K01c member não edita contrato', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'FORBIDDEN', 'K01c member não edita contrato', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.set_support_contract_status(v_member, v_k1, 'suspenso');
    insert into r values (false, 'K01d member não muda status', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'FORBIDDEN', 'K01d member não muda status', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.create_support_contract(v_admin, v_k, 'ativo', v_start, 10, 10, array[v_p1]);
    insert into r values (false, 'K03a segundo contrato ativo', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CURRENT_CONTRACT_EXISTS', 'K03a segundo contrato ativo', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.create_support_contract(v_admin, v_k, 'suspenso', v_start, 10, 10, array[v_p1]);
    insert into r values (false, 'K03b segundo contrato suspenso', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CURRENT_CONTRACT_EXISTS', 'K03b segundo contrato suspenso', sqlstate || ' ' || sqlerrm);
  end;

  -- só a RPC escreve contrato
  foreach v_sql in array array[
    format('insert into public.support_contracts (customer_id, starts_on, monthly_amount, billing_day) values (%L, %L, 1, 1)', v_y, v_start),
    format('update public.support_contracts set billing_day = 5 where id = %L', v_k1),
    format('delete from public.support_contracts where id = %L', v_k1),
    format('insert into public.support_contract_products (contract_id, product_id) values (%L, %L)', v_k1, v_p3),
    format('update public.support_contract_products set product_id = %L where contract_id = %L', v_p3, v_k1),
    format('delete from public.support_contract_products where contract_id = %L', v_k1)
  ] loop
    begin
      execute v_sql;
      v_fail := concat_ws('; ', v_fail, v_sql || ' → passou');
    exception when others then
      if sqlstate <> '42501' then
        v_fail := concat_ws('; ', v_fail, v_sql || ' → ' || sqlstate);
      end if;
    end;
  end loop;
  insert into r values (v_fail is null, 'K04 escrita direta no contrato negada', coalesce(v_fail, '6 × 42501'));

  -- o valor é ilegível fora da RPC
  begin
    perform * from public.support_contracts where id = v_k1;
    insert into r values (false, 'K05a select * negado', 'leu');
  exception when others then
    insert into r values (sqlstate = '42501', 'K05a select * negado', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform monthly_amount from public.support_contracts where id = v_k1;
    insert into r values (false, 'K05b select monthly_amount negado', 'leu');
  exception when others then
    insert into r values (sqlstate = '42501', 'K05b select monthly_amount negado', sqlstate || ' ' || sqlerrm);
  end;
  select c.id, c.status, c.billing_day into v_id, v_t, v_n from public.support_contracts c where c.id = v_k1;
  insert into r values (v_id = v_k1 and v_t = 'ativo' and v_n = 10, 'K05c colunas sem valor legíveis',
    coalesce(v_t, '<null>') || ' | dia ' || coalesce(v_n::text, '<null>'));

  select g.monthly_amount into v_amount
    from public.get_support_contract_amounts(v_admin, v_k) g
   where g.contract_id = v_k1;
  insert into r values (v_amount = 1234.56 and v_amount::text = '1234.56', 'K06a admin lê o valor exato',
    coalesce(v_amount::text, '<null>'));
  begin
    perform public.get_support_contract_amounts(v_member, v_k);
    insert into r values (false, 'K06b member não lê o valor', 'leu');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'FORBIDDEN', 'K06b member não lê o valor', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.get_support_contract_amounts(v_inactive, v_k);
    insert into r values (false, 'K06c admin inativo não lê o valor', 'leu');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'FORBIDDEN', 'K06c admin inativo não lê o valor', sqlstate || ' ' || sqlerrm);
  end;

  -- suspender: selo e idempotência
  j := public.set_support_contract_status(v_admin, v_k1, 'suspenso');
  select contract_status into v_t from public.customers where id = v_k;
  insert into r values ((j->>'changed')::boolean and v_t = 'suspenso', 'K07a suspender muda o selo',
    j::text || ' | ' || coalesce(v_t, '<null>'));
  j := public.set_support_contract_status(v_admin, v_k1, 'suspenso');
  insert into r values (not (j->>'changed')::boolean and j->>'status' = 'suspenso', 'K07b repetir o status é no-op', j::text);

  begin
    perform public.create_support_contract(v_admin, v_k, 'ativo', v_start, 10, 10, array[v_p1]);
    insert into r values (false, 'K03c contrato novo com um suspenso', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CURRENT_CONTRACT_EXISTS', 'K03c contrato novo com um suspenso', sqlstate || ' ' || sqlerrm);
  end;

  -- sincronização dos produtos (a ctid só muda se a linha for reescrita)
  perform public.update_support_contract(v_admin, v_k1, v_start, 1234.56, 10, array[v_p2]);
  select string_agg(l.product_id::text, ',' order by l.product_id), string_agg(l.ctid::text, ',' order by l.product_id)
    into v_t, v_c
    from public.support_contract_products l
   where l.contract_id = v_k1;
  insert into r values (v_t = v_p2::text, 'K13a subconjunto troca exatamente o conjunto', coalesce(v_t, '<vazio>'));
  perform public.update_support_contract(v_admin, v_k1, v_start, 1234.56, 10, array[v_p2]);
  select string_agg(l.ctid::text, ',' order by l.product_id) into v_t2
    from public.support_contract_products l
   where l.contract_id = v_k1;
  insert into r values (v_t2 = v_c, 'K13b repetir não reescreve os produtos', coalesce(v_c, '<vazio>') || ' → ' || coalesce(v_t2, '<vazio>'));

  -- encerrar sem data e encerrado terminal
  j := public.set_support_contract_status(v_admin, v_k1, 'encerrado');
  select c.ends_on into v_d from public.support_contracts c where c.id = v_k1;
  select contract_status into v_t from public.customers where id = v_k;
  insert into r values (v_d = v_today and (j->>'ends_on')::date = v_today and v_t = 'encerrado',
    'K08a encerrar sem data usa hoje em SP e o selo', j::text || ' | ' || coalesce(v_t, '<null>'));
  begin
    perform public.update_support_contract(v_admin, v_k1, v_start, 1234.56, 10, array[v_p2]);
    insert into r values (false, 'K08b encerrado não é editado', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CONTRACT_CLOSED', 'K08b encerrado não é editado', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.set_support_contract_status(v_admin, v_k1, 'ativo');
    insert into r values (false, 'K08c encerrado não reabre', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CONTRACT_CLOSED', 'K08c encerrado não reabre', sqlstate || ' ' || sqlerrm);
  end;

  v_k2 := public.create_support_contract(v_admin, v_k, 'ativo', v_today, 990, 5, array[v_p1]);
  select contract_status into v_t from public.customers where id = v_k;
  insert into r values (v_t = 'ativo', 'K09 renovação depois de encerrar', coalesce(v_t, '<null>'));

  -- encerrar sem data um contrato que só começa no futuro (20260925120800):
  -- o término padrão é o maior entre hoje e o início, não "hoje" antes dele
  insert into public.customers (legal_name) values ('Empresa Teste Futuro') returning id into v_f;
  v_fk := public.create_support_contract(v_admin, v_f, 'ativo', v_today + 10, 100, 5, array[v_p1]);
  j := public.set_support_contract_status(v_admin, v_fk, 'encerrado');
  select c.ends_on into v_d from public.support_contracts c where c.id = v_fk;
  insert into r values (v_d = v_today + 10 and (j->>'ends_on')::date = v_today + 10,
    'K08d encerrar sem data contrato futuro usa o início', j::text);

  -- checks nomeados, pela RPC
  begin
    perform public.create_support_contract(v_admin, v_y, 'ativo', v_start, 100, 29, array[v_p1]);
    insert into r values (false, 'K10a dia de vencimento 29', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23514' and v_c = 'support_contracts_billing_day_check',
      'K10a dia de vencimento 29', sqlstate || ' ' || v_c);
  end;
  begin
    perform public.create_support_contract(v_admin, v_y, 'ativo', v_start, 100, 10, array[v_p1], null, v_start - 1);
    insert into r values (false, 'K10b término antes do início', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23514' and v_c = 'support_contracts_term_check',
      'K10b término antes do início', sqlstate || ' ' || v_c);
  end;
  begin
    perform public.create_support_contract(v_admin, v_y, 'ativo', v_start, -1, 10, array[v_p1]);
    insert into r values (false, 'K10c valor negativo', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23514' and v_c = 'support_contracts_amount_check',
      'K10c valor negativo', sqlstate || ' ' || v_c);
  end;

  begin
    perform public.create_support_contract(v_admin, v_y, 'encerrado', v_start, 100, 10, array[v_p1], null, v_today);
    insert into r values (false, 'K11 contrato nasce vigente', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'INVALID_STATUS', 'K11 contrato nasce vigente', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.create_support_contract(v_admin, v_a, 'ativo', v_start, 100, 10, array[v_p1]);
    insert into r values (false, 'K15a empresa arquivada não recebe contrato', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CUSTOMER_ARCHIVED', 'K15a empresa arquivada não recebe contrato', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.create_support_contract(v_admin, gen_random_uuid(), 'ativo', v_start, 100, 10, array[v_p1]);
    insert into r values (false, 'K15b empresa inexistente', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CUSTOMER_NOT_FOUND', 'K15b empresa inexistente', sqlstate || ' ' || sqlerrm);
  end;

  -- arquivar empresa com contrato vigente
  begin
    update public.customers set archived_at = now() where id = v_k;
    insert into r values (false, 'K16a arquivar com vigente barrado', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CUSTOMER_HAS_CURRENT_CONTRACT', 'K16a arquivar com vigente barrado', sqlstate || ' ' || sqlerrm);
  end;
  perform public.set_support_contract_status(v_admin, v_k2, 'encerrado');
  update public.customers set archived_at = now() where id = v_k;
  select count(*) into v_n from public.customers where id = v_k and archived_at is not null;
  insert into r values (v_n = 1, 'K16b depois de encerrar, arquiva', v_n::text);

  -- contrato que o segundo bloco edita depois de arquivar a fila e o plano
  v_x1 := public.create_support_contract(v_admin, v_x, 'ativo', v_start, 500, 5, array[v_p1, v_p3], v_plan2);

  -- vínculo contato → empresa
  select count(*) into v_n0 from public.contact_events
   where contact_id = v_contact and event_type = 'contact.archived';

  update public.contacts set customer_id = v_a2 where id = v_contact;
  select count(*) into v_n from public.contact_events e
   where e.contact_id = v_contact and e.event_type = 'contact.customer_linked'
     and e.entity_type = 'customer' and e.entity_id = v_a2
     and e.metadata = jsonb_build_object('from', null, 'to', v_a2);
  insert into r values (v_n = 1, 'L01 ligar grava customer_linked {from:null,to}', v_n::text);

  update public.contacts set customer_id = v_b where id = v_contact;
  select count(*) into v_n from public.contact_events e
   where e.contact_id = v_contact and e.event_type = 'contact.customer_changed'
     and e.entity_type = 'customer' and e.entity_id = v_b
     and e.metadata = jsonb_build_object('from', v_a2, 'to', v_b);
  insert into r values (v_n = 1, 'L02a trocar grava customer_changed', v_n::text);
  update public.contacts set customer_id = null where id = v_contact;
  select count(*) into v_n from public.contact_events e
   where e.contact_id = v_contact and e.event_type = 'contact.customer_unlinked'
     and e.entity_type = 'customer' and e.entity_id = v_b
     and e.metadata = jsonb_build_object('from', v_b, 'to', null);
  insert into r values (v_n = 1, 'L02b desligar aponta a empresa anterior', v_n::text);

  begin
    update public.contacts set customer_id = gen_random_uuid() where id = v_contact;
    insert into r values (false, 'L03 FK do contato para a empresa', 'passou');
  exception when others then
    get stacked diagnostics v_c = constraint_name;
    insert into r values (sqlstate = '23503' and v_c = 'contacts_customer_id_fkey',
      'L03 FK do contato para a empresa', sqlstate || ' ' || v_c);
  end;

  begin
    update public.contacts set customer_id = v_a where id = v_contact;
    insert into r values (false, 'L04 empresa arquivada não recebe contato', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'CUSTOMER_ARCHIVED', 'L04 empresa arquivada não recebe contato', sqlstate || ' ' || sqlerrm);
  end;

  update public.contacts set archived_at = now() where id = v_contact;
  select count(*) into v_n from public.contact_events
   where contact_id = v_contact and event_type = 'contact.archived';
  insert into r values (v_n = v_n0 + 1, 'L05 arquivar contato ainda grava contact.archived', v_n0 || ' → ' || v_n);

  -- helpers internos não viram RPC
  begin
    perform public.require_active_admin(v_admin);
    insert into r values (false, 'A01a require_active_admin fora do service_role', 'executou');
  exception when others then
    insert into r values (sqlstate = '42501', 'A01a require_active_admin fora do service_role', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.assert_contract_refs(null, array[v_p1], null);
    insert into r values (false, 'A01b assert_contract_refs fora do service_role', 'executou');
  exception when others then
    insert into r values (sqlstate = '42501', 'A01b assert_contract_refs fora do service_role', sqlstate || ' ' || sqlerrm);
  end;

  insert into ids values
    ('erp', v_erp), ('p1', v_p1), ('p3', v_p3), ('plan2', v_plan2),
    ('customer_y', v_y), ('contract_x', v_x1);
end
$$;

reset role;

-- Arquivar fila e plano não é do app nesta fase.
update public.products set archived_at = now() where id in (select id from ids where k in ('erp', 'p3'));
update public.support_plans set archived_at = now() where id = (select id from ids where k = 'plan2');

set role service_role;

do $$
declare
  v_admin uuid; v_p1 uuid; v_p3 uuid; v_plan2 uuid; v_y uuid; v_x1 uuid; v_id uuid;
  v_start date := (now() at time zone 'America/Sao_Paulo')::date - 30;
  v_t text;
begin
  select id into v_admin from ids where k = 'admin';
  select id into v_p1 from ids where k = 'p1';
  select id into v_p3 from ids where k = 'p3';
  select id into v_plan2 from ids where k = 'plan2';
  select id into v_y from ids where k = 'customer_y';
  select id into v_x1 from ids where k = 'contract_x';

  insert into public.products (name) values ('ERP') returning id into v_id;
  insert into r values (v_id is not null, 'P01d arquivar libera o nome da fila', '');

  -- referências do contrato
  begin
    perform public.create_support_contract(v_admin, v_y, 'ativo', v_start, 100, 10, '{}'::uuid[]);
    insert into r values (false, 'K12a sem produto', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'PRODUCTS_REQUIRED', 'K12a sem produto', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.create_support_contract(v_admin, v_y, 'ativo', v_start, 100, 10, array[gen_random_uuid()]);
    insert into r values (false, 'K12b produto inexistente', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'PRODUCT_NOT_FOUND', 'K12b produto inexistente', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform public.create_support_contract(v_admin, v_y, 'ativo', v_start, 100, 10, array[v_p1, v_p3]);
    insert into r values (false, 'K12c fila arquivada não entra', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'PRODUCT_ARCHIVED', 'K12c fila arquivada não entra', sqlstate || ' ' || sqlerrm);
  end;

  perform public.update_support_contract(v_admin, v_x1, v_start, 500, 5, array[v_p1, v_p3], v_plan2);
  select string_agg(l.product_id::text, ',' order by l.product_id) into v_t
    from public.support_contract_products l
   where l.contract_id = v_x1;
  insert into r values (
    v_t = (select string_agg(p::text, ',' order by p) from unnest(array[v_p1, v_p3]) as p),
    'K12d fila arquivada já coberta permanece na edição', coalesce(v_t, '<vazio>'));

  -- a fila arquivada sai; depois não volta
  perform public.update_support_contract(v_admin, v_x1, v_start, 500, 5, array[v_p1], v_plan2);
  begin
    perform public.update_support_contract(v_admin, v_x1, v_start, 500, 5, array[v_p1, v_p3], v_plan2);
    insert into r values (false, 'K12e fila arquivada não volta na edição', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'PRODUCT_ARCHIVED', 'K12e fila arquivada não volta na edição', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform public.create_support_contract(v_admin, v_y, 'ativo', v_start, 100, 10, array[v_p1], v_plan2);
    insert into r values (false, 'K14a plano arquivado não entra', 'passou');
  exception when others then
    insert into r values (sqlstate = 'P0001' and sqlerrm = 'PLAN_ARCHIVED', 'K14a plano arquivado não entra', sqlstate || ' ' || sqlerrm);
  end;
  select c.plan_id into v_id from public.support_contracts c where c.id = v_x1;
  insert into r values (v_id = v_plan2, 'K14b plano arquivado do contrato permanece na edição', coalesce(v_id::text, '<null>'));
end
$$;

reset role;

-- navegador: nenhuma tabela nem RPC de cadastro para authenticated e anon
do $$
declare
  v_role text; v_sql text; v_fail text;
begin
  foreach v_role in array array['authenticated', 'anon'] loop
    v_fail := null;
    execute format('set local role %I', v_role);
    foreach v_sql in array array[
      'select * from public.products limit 1',
      'select * from public.support_plans limit 1',
      'select * from public.customers limit 1',
      'select * from public.support_contracts limit 1',
      'select * from public.support_contract_products limit 1',
      'select public.create_support_contract(null, null, null, null, null, null, null)',
      'select public.update_support_contract(null, null, null, null, null, null)',
      'select public.set_support_contract_status(null, null, null)',
      'select * from public.get_support_contract_amounts(null, null)'
    ] loop
      begin
        execute v_sql;
        v_fail := concat_ws('; ', v_fail, v_sql || ' → passou');
      exception when others then
        if sqlstate <> '42501' then
          v_fail := concat_ws('; ', v_fail, v_sql || ' → ' || sqlstate);
        end if;
      end;
    end loop;
    reset role;
    insert into r values (v_fail is null, 'B01 ' || v_role || ' sem tabela nem RPC de cadastro', coalesce(v_fail, '9 × 42501'));
  end loop;
end
$$;

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select string_agg(teste, '; ' order by teste) into v_falhas from r where not ok;
  if v_falhas is not null then
    raise exception 'testes de cadastros falharam: %', v_falhas;
  end if;
  raise notice 'testes de cadastros: % caso(s), todos ok', (select count(*) from r);
end $$;

rollback;
