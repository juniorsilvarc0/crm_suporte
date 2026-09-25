-- ============================================================================
-- Seed LOCAL (dev). Rodado por scripts/db-local-apply.sh DEPOIS das migrations,
-- numa transação só. Nunca vai para produção.
--
-- ⚠️ Só DADO. Nada de grant, revoke ou default privileges aqui: o seed herdado
-- da clínica fazia `grant all ... to service_role` e desfazia em silêncio o
-- menor privilégio do baseline (revisão da Fase 2, B1). O assert do fim pega
-- se alguém repetir o erro.
-- ============================================================================

-- Login do app em dev: admin@local / 123456.
insert into public.app_users (email, name, password_hash, role)
values ('admin@local', 'Administrador', extensions.crypt('123456', extensions.gen_salt('bf')), 'admin')
on conflict do nothing;

-- Etiquetas de exemplo para o chat.
insert into public.tags (id, name, color) values
  ('11111111-1111-1111-1111-111111111101', 'Urgente', 'rose'),
  ('11111111-1111-1111-1111-111111111102', 'Aguardando cliente', 'amber'),
  ('11111111-1111-1111-1111-111111111103', 'Financeiro', 'emerald')
on conflict (id) do nothing;

-- Contato de exemplo. A única porta de criação de contato é o resolvedor de
-- identidade (dedup por telefone com advisory lock), inclusive aqui.
select public.resolve_contact_identity('5511990000099', 'Contato de Exemplo', 'manual');

select public.assert_security_baseline();
