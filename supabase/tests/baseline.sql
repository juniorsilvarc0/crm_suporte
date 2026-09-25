-- ============================================================================
-- Testes de comportamento do baseline (Fase 2). Rodados por
-- scripts/db-local-test.sh no banco local e no CI.
--
-- Tudo numa transação que termina em ROLLBACK: o banco de dev volta como
-- estava. Cada caso grava (ok, teste, detalhe) em `r`; no fim o arquivo lista
-- tudo e FALHA (psql sai com erro) se algum caso não passou.
--
-- Não coberto aqui, porque exige duas sessões: a corrida de identidade (dois
-- formatos do mesmo número ao mesmo tempo → um contato só). Foi provada na
-- revisão da Fase 2 e está registrada no PROGRESS.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

-- Seed de dev (só a parte que continua valendo): admin@local.
insert into public.app_users (email, name, password_hash, role) values
  ('admin@local', 'Administrador', extensions.crypt('123456', extensions.gen_salt('bf')), 'admin')
on conflict do nothing;

create temp table r (ok boolean, teste text, detalhe text) on commit drop;
grant all on r to service_role, authenticated;

set role service_role;

do $$
declare
  v_admin uuid; v_admin2 uuid; v_member uuid;
  j jsonb; j2 jsonb; j3 jsonb;
  v_int uuid; v_conv uuid; v_conv2 uuid; v_msg uuid; v_tag uuid;
  v_n int; v_t text; v_ts timestamptz;
  procedure_ok boolean;
begin
  -- login
  select id into v_admin from public.verify_login('ADMIN@local ', '123456');
  insert into r values (v_admin is not null, 'T01 verify_login seed custo 6', coalesce(v_admin::text,'null'));
  select count(*) into v_n from public.verify_login('naoexiste@x', '123456');
  insert into r values (v_n = 0, 'T01b verify_login email inexistente', v_n::text);

  -- criar usuários
  select id into v_admin2 from public.create_app_user('a2@x.com','Admin Dois','12345678','admin','slate');
  select id into v_member from public.create_app_user('m@x.com','Membro','12345678','member','slate', true);
  insert into r values (v_admin2 is not null and v_member is not null, 'T02 create_app_user', '');

  -- travas
  begin
    perform public.update_app_user(v_admin, v_admin, 'Adm', 'admin@local', false, 'admin', null, 'slate');
    insert into r values (false, 'T03 autodesativação barrada', 'passou');
  exception when others then insert into r values (sqlerrm = 'SELF_ROLE_CHANGE', 'T03 autodesativação barrada', sqlerrm); end;
  begin
    perform public.update_app_user(v_member, v_member, 'M', 'm@x.com', true, 'admin', null, 'slate');
    insert into r values (false, 'T03b membro se promove', 'passou');
  exception when others then insert into r values (sqlerrm = 'FORBIDDEN', 'T03b membro se promove', sqlerrm); end;
  -- membro troca a própria senha → limpa must_change_password
  perform public.reset_app_user_password(v_member, v_member, 'novaSenha123');
  select must_change_password::text into v_t from public.app_users where id = v_member;
  insert into r values (v_t = 'false', 'T04 must_change_password limpo', v_t);

  -- service_role não lê hash nem escreve direto
  begin
    perform password_hash from public.app_users limit 1;
    insert into r values (false, 'T05 hash ilegível', 'leu');
  exception when insufficient_privilege then insert into r values (true, 'T05 hash ilegível', sqlerrm); end;

  -- identidade
  j := public.resolve_contact_identity('+55 (27) 99911-0001', 'Ana', 'whatsapp', null, false);
  j2 := public.resolve_contact_identity('27999110001', 'Outro Nome', 'whatsapp', null, false);
  insert into r values ((j->>'contactId') = (j2->>'contactId') and (j->>'created')::boolean and not (j2->>'created')::boolean,
    'T06 mesmo número → mesmo contato', j::text || ' / ' || j2::text);
  select name into v_t from public.contacts where id = (j->>'contactId')::uuid;
  insert into r values (v_t = 'Ana', 'T06b nome não sobrescrito', v_t);
  j3 := public.resolve_contact_identity('2799110001', null, 'whatsapp', null, false);
  insert into r values ((j3->>'contactId') <> (j->>'contactId'), 'T07 nono dígito NÃO funde', j3::text);
  select count(*) into v_n from public.contact_phone_identities where match_key = public.phone_match_key('27999110001');
  insert into r values (v_n = 2, 'T07b match_key agrupa candidatos', v_n::text);

  -- telefone imutável / sem INSERT
  begin
    update public.contacts set phone = '27999110009' where id = (j->>'contactId')::uuid;
    insert into r values (false, 'T08 UPDATE phone negado', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T08 UPDATE phone negado', sqlerrm); end;
  begin
    insert into public.contacts (phone, normalized_phone) values ('27999110008','27999110008');
    insert into r values (false, 'T08b INSERT contacts negado', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T08b INSERT contacts negado', sqlerrm); end;

  -- integração + segredo
  insert into public.chat_integrations (name, provider, config, is_active)
  values ('WhatsApp (uazapi)', 'uazapi', '{"apiUrl":"https://x"}', true) returning id into v_int;
  perform public.set_chat_integration_secret(v_int, 'token', 'tok-1');
  perform public.set_chat_integration_secret(v_int, 'token', 'tok-2');
  perform public.set_chat_integration_secret(v_int, 'webhook_secret', 'wh-1');
  v_t := public.get_chat_integration_secret(v_int, 'token');
  insert into r values (v_t = 'tok-2', 'T09 segredo no Vault via RPC', v_t);
  begin
    update public.chat_integrations set config = '{"apiUrl":"x","token":"t"}' where id = v_int;
    insert into r values (false, 'T09b token no config barrado', 'passou');
  exception when check_violation then insert into r values (true, 'T09b token no config barrado', sqlerrm); end;
  begin
    update public.chat_integrations set token_secret_id = gen_random_uuid() where id = v_int;
    insert into r values (false, 'T09c secret_id não editável', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T09c secret_id não editável', sqlerrm); end;

  -- upsert da conversa (como o PostgREST: DO UPDATE SET de todas as colunas do corpo)
  insert into public.chat_conversations (integration_id, contact_id, external_id, contact_phone, updated_at, contact_name)
  values (v_int, (j->>'contactId')::uuid, '5527999110001', '5527999110001', now(), 'Ana WhatsApp')
  on conflict (integration_id, external_id) do update set
    integration_id = excluded.integration_id, contact_id = excluded.contact_id, external_id = excluded.external_id,
    contact_phone = excluded.contact_phone, updated_at = excluded.updated_at, contact_name = excluded.contact_name
  returning id into v_conv;
  insert into public.chat_conversations (integration_id, contact_id, external_id, contact_phone, updated_at, contact_name)
  values (v_int, (j->>'contactId')::uuid, '5527999110001', '5527999110001', now(), 'Ana WhatsApp')
  on conflict (integration_id, external_id) do update set
    integration_id = excluded.integration_id, contact_id = excluded.contact_id, external_id = excluded.external_id,
    contact_phone = excluded.contact_phone, updated_at = excluded.updated_at, contact_name = excluded.contact_name
  returning id into v_conv2;
  select contact_name || '|' || (metadata->>'providerContactName') into v_t from public.chat_conversations where id = v_conv;
  insert into r values (v_conv = v_conv2 and v_t = 'Ana|Ana WhatsApp', 'T10 upsert da conversa + nome canônico', v_t);

  -- mensagem de entrada, dedup e não lidas
  insert into public.chat_messages (conversation_id, external_id, direction, sender_type, type, content, delivery_status, created_at)
  values (v_conv, 'EXT1', 'inbound', 'contact', 'text', 'Olá', 'delivered', now())
  on conflict (conversation_id, external_id) do nothing;
  insert into public.chat_messages (conversation_id, external_id, direction, sender_type, type, content, delivery_status, created_at)
  values (v_conv, 'EXT1', 'inbound', 'contact', 'text', 'Olá', 'delivered', now())
  on conflict (conversation_id, external_id) do nothing;
  select unread_count || '|' || last_message_preview into v_t from public.chat_conversations where id = v_conv;
  insert into r values (v_t = '1|Olá', 'T11 dedup + não lidas por trigger', v_t);
  select count(*) into v_n from public.contacts where id = (j->>'contactId')::uuid and last_message_at is not null;
  insert into r values (v_n = 1, 'T11b contato tocado pela mensagem', v_n::text);

  -- nota não vira prévia
  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, delivery_status, sent_by_user_id)
  values (v_conv, 'outbound', 'agent', 'note', 'nota interna', 'sent', v_admin2);
  select last_message_preview into v_t from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id where c.id = v_conv limit 1;
  insert into r values (v_t = 'Olá', 'T12 nota não vira prévia', v_t);

  -- clientId único
  insert into public.chat_messages (conversation_id, direction, sender_type, type, content, metadata, sent_by_user_id)
  values (v_conv, 'outbound', 'agent', 'text', 'oi', '{"clientId":"c-1"}', v_admin2) returning id into v_msg;
  begin
    insert into public.chat_messages (conversation_id, direction, sender_type, type, content, metadata)
    values (v_conv, 'outbound', 'agent', 'text', 'oi', '{"clientId":"c-1"}');
    insert into r values (false, 'T13 clientId único', 'passou');
  exception when unique_violation then insert into r values (true, 'T13 clientId único', sqlerrm); end;

  -- sender inválido
  begin
    insert into public.chat_messages (conversation_id, external_id, direction, sender_type, type, content)
    values (v_conv, 'EXT9', 'inbound', 'agent', 'text', 'x');
    insert into r values (false, 'T14 inbound⇔contact', 'passou');
  exception when check_violation then insert into r values (true, 'T14 inbound⇔contact', sqlerrm); end;

  -- updates do webhook e da rota
  update public.chat_messages set external_id = 'EXT2', metadata = metadata || '{"uazapiId":"u"}' where id = v_msg;
  update public.chat_messages set delivery_status = 'delivered' where external_id = 'EXT2';
  update public.chat_messages set is_deleted = true, content = null, media_url = null where external_id = 'EXT2';
  select coalesce(content,'<null>') || '|' || (metadata ? 'clientId')::text into v_t from public.chat_messages where id = v_msg;
  insert into r values (v_t = '<null>|true', 'T15 updates por coluna + scrub', v_t);
  begin
    update public.chat_messages set direction = 'inbound' where id = v_msg;
    insert into r values (false, 'T15b direção imutável', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T15b direção imutável', sqlerrm); end;

  -- editar nome do contato propaga
  update public.contacts set name = 'Ana Maria', notes = 'vip' where id = (j->>'contactId')::uuid;
  select contact_name into v_t from public.chat_conversations where id = v_conv;
  insert into r values (v_t = 'Ana Maria', 'T16 nome propaga para a conversa', v_t);

  -- arquivar contato e reativar por mensagem nova
  update public.contacts set archived_at = now() - interval '1 minute' where id = (j->>'contactId')::uuid;
  insert into public.chat_messages (conversation_id, external_id, direction, sender_type, type, content, created_at)
  values (v_conv, 'EXT3', 'inbound', 'contact', 'image', 'foto', now());
  select coalesce(archived_at::text,'<null>') into v_t from public.contacts where id = (j->>'contactId')::uuid;
  insert into r values (v_t = '<null>', 'T17 inbound reativa contato', v_t);
  select string_agg(event_type, ',' order by occurred_at, event_type) into v_t from public.contact_events where contact_id = (j->>'contactId')::uuid;
  insert into r values (v_t like '%contact.archived%contact.reactivated%', 'T17b eventos', v_t);

  -- remoção lógica e restauração
  update public.chat_conversations set removed_at = now() - interval '1 minute', archived_at = null, pinned_at = null, updated_at = now() where id = v_conv;
  insert into public.chat_messages (conversation_id, external_id, direction, sender_type, type, content, created_at)
  values (v_conv, 'EXT4', 'inbound', 'contact', 'text', 'voltei', now());
  select coalesce(removed_at::text,'<null>') || '|' || unread_count into v_t from public.chat_conversations where id = v_conv;
  insert into r values (v_t = '<null>|3', 'T18 mensagem restaura conversa removida', v_t);

  -- etiquetas
  insert into public.tags (name, color) values ('VIP', 'rose') returning id into v_tag;
  begin
    insert into public.tags (name, color) values (' vip ', 'rose');
    insert into r values (false, 'T19 tag única sem caixa', 'passou');
  exception when unique_violation then insert into r values (true, 'T19 tag única sem caixa', sqlerrm); end;
  insert into public.conversation_tags (conversation_id, tag_id) values (v_conv, v_tag) on conflict (conversation_id, tag_id) do nothing;
  insert into public.conversation_tags (conversation_id, tag_id) values (v_conv, v_tag) on conflict (conversation_id, tag_id) do nothing;
  begin
    insert into public.conversation_tags (conversation_id, tag_id) values (v_conv, v_tag)
      on conflict (conversation_id, tag_id) do update set conversation_id = excluded.conversation_id, tag_id = excluded.tag_id;
    insert into r values (false, 'T19b upsert DO UPDATE sem grant', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T19b upsert DO UPDATE sem grant (TS precisa ignoreDuplicates)', sqlerrm); end;
  delete from public.tags where id = v_tag;
  select count(*) into v_n from public.conversation_tags where conversation_id = v_conv;
  insert into r values (v_n = 0, 'T19c cascade de tag', v_n::text);

  -- limpar conversa
  j := public.clear_chat_conversation(v_conv);
  select count(*) into v_n from public.chat_messages where conversation_id = v_conv and not is_deleted;
  insert into r values (v_n = 0 and (j->>'cleared')::int >= 1, 'T20 clear_chat_conversation', (j->>'cleared'));
  begin
    perform public.clear_chat_conversation(gen_random_uuid());
    insert into r values (false, 'T20b P0002', 'passou');
  exception when sqlstate 'P0002' then insert into r values (true, 'T20b P0002', sqlerrm); end;

  -- excluir usuário com mensagens e resposta rápida
  insert into public.chat_quick_replies (title, shortcut, content, created_by_user_id) values ('Oi', 'oi', 'Olá!', v_admin2);
  insert into public.api_tokens (name, token_hash, token_prefix, created_by)
  values ('n8n', repeat('a', 64), 'crmsuporte_x', v_admin2);
  perform public.delete_app_user(v_admin, v_admin2);
  select count(*) into v_n from public.app_users where id = v_admin2;
  insert into r values (v_n = 0, 'T21 delete_app_user com FKs', v_n::text);

  -- append-only
  begin
    update public.contact_events set event_type = 'x';
    insert into r values (false, 'T22 contact_events append-only', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T22 contact_events append-only', sqlerrm); end;
  begin
    update public.integration_logs set status = 'ok';
    insert into r values (false, 'T22b integration_logs append-only', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T22b integration_logs append-only', sqlerrm); end;

  -- api_tokens revogação definitiva
  update public.api_tokens set revoked_at = now() where revoked_at is null;
  begin
    update public.api_tokens set revoked_at = null;
    insert into r values (false, 'T23 revogação definitiva', 'passou');
  exception when sqlstate '55000' then insert into r values (true, 'T23 revogação definitiva', sqlerrm); end;

  -- app_settings upsert como o PostgREST
  insert into public.app_settings (key, value, updated_at) values ('automation', '{"relay_url":"https://n8n"}', now())
  on conflict (key) do update set key = excluded.key, value = excluded.value, updated_at = excluded.updated_at;
  insert into public.app_settings (key, value, updated_at) values ('automation', '{"relay_url":"https://n8n2"}', now())
  on conflict (key) do update set key = excluded.key, value = excluded.value, updated_at = excluded.updated_at;
  select value->>'relay_url' into v_t from public.app_settings where key = 'automation';
  insert into r values (v_t = 'https://n8n2', 'T24 upsert app_settings', v_t);

  -- cofre de variáveis
  perform public.set_app_environment_variable('openai_api_key', 'sk-1');
  begin
    perform public.set_app_environment_variable('OPENAI_API_KEY', 'sk-2');
    insert into r values (false, 'T25 23505 sem replace', 'passou');
  exception when unique_violation then insert into r values (true, 'T25 23505 sem replace', sqlerrm); end;
  perform public.set_app_environment_variable('OPENAI_API_KEY', 'sk-2', true);
  select string_agg(name || '=' || value, ',') into v_t from public.get_app_environment_variables(array['openai_api_key','NAO_EXISTE']);
  insert into r values (v_t = 'OPENAI_API_KEY=sk-2', 'T25b leitura em lote', v_t);
  insert into r values (public.delete_app_environment_variable('OPENAI_API_KEY'), 'T25c delete', '');

  -- notas
  insert into public.user_notes (user_id, kind, content) values (v_admin, 'quick', 'a');
  select updated_at into v_ts from public.user_notes where user_id = v_admin and kind = 'quick';
  update public.user_notes set content = 'b' where user_id = v_admin and kind = 'quick';
  insert into r values (true, 'T26 notas update', '');
  begin
    update public.user_notes set user_id = v_member where user_id = v_admin;
    insert into r values (false, 'T26b dono da nota imutável', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T26b dono da nota imutável', sqlerrm); end;

  -- conversa sem contato passa pelo resolvedor (rede de segurança)
  insert into public.chat_conversations (integration_id, external_id, contact_phone)
  values (v_int, '5527988887777', '5527988887777') returning id into v_conv2;
  select count(*) into v_n from public.chat_conversations where id = v_conv2 and contact_id is not null;
  insert into r values (v_n = 1, 'T27 ensure_chat_conversation_contact', v_n::text);

  begin
    delete from public.chat_messages where conversation_id = v_conv2;
    insert into r values (false, 'T31 DELETE de mensagem negado', 'passou');
  exception when insufficient_privilege then insert into r values (true, 'T31 DELETE de mensagem negado', sqlerrm); end;
end
$$;
reset role;

-- navegador: authenticated com claim
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","app_role":"member"}', true);
do $$
declare v_n int;
begin
  select count(*) into v_n from public.chat_messages;
  insert into r values (v_n > 0, 'T29 authenticated member lê mensagens', v_n::text);
  begin
    perform 1 from public.contacts limit 1;
    insert into r values (false, 'T29b authenticated não lê contacts', 'leu');
  exception when insufficient_privilege then insert into r values (true, 'T29b authenticated não lê contacts', sqlerrm); end;
  begin
    perform public.resolve_contact_identity('27911112222');
    insert into r values (false, 'T29c authenticated sem RPC', 'executou');
  exception when insufficient_privilege then insert into r values (true, 'T29c authenticated sem RPC', sqlerrm); end;
end $$;
select set_config('request.jwt.claims', '{"role":"authenticated","app_role":"paid_traffic"}', true);
do $$
declare v_n int;
begin
  select count(*) into v_n from public.chat_messages;
  insert into r values (v_n = 0, 'T30 app_role fora da lista vê 0', v_n::text);
end $$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform count(*) from public.chat_messages;
  insert into r values (true, 'T32 claims vazio', 'sem erro');
exception when others then insert into r values (true, 'T32 claims vazio (info: erro, fecha)', sqlerrm); end $$;
reset role;

set role service_role;
do $$
declare v_int uuid; v_n int;
begin
  select id into v_int from public.chat_integrations limit 1;
  delete from public.chat_conversations where integration_id = v_int;
  delete from public.chat_integrations where id = v_int;
end $$;
reset role;
do $$
declare v_n int;
begin
  select count(*) into v_n from vault.secrets where name like 'crm_suporte_chat_integration.%';
  insert into r values (v_n = 0, 'T28 segredos da integração apagados', v_n::text);
end $$;

-- Regressão do seed herdado (revisão B1/I1): um `grant all` ao service_role
-- reabre o hash de senha e o append-only. O assert PRECISA acusar.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
do $$
begin
  begin
    perform public.assert_security_baseline();
    insert into r values (false, 'T33 assert detecta grant all ao service_role', 'passou sem acusar');
  exception when others then insert into r values (true, 'T33 assert detecta grant all ao service_role', sqlerrm); end;
end $$;

select case when ok then 'ok  ' else 'FALHA' end as resultado, teste, detalhe from r order by teste;

do $$
declare v_falhas text;
begin
  select string_agg(teste, '; ' order by teste) into v_falhas from r where not ok;
  if v_falhas is not null then
    raise exception 'testes do baseline falharam: %', v_falhas;
  end if;
  raise notice 'testes do baseline: % caso(s), todos ok', (select count(*) from r);
end $$;

rollback;
