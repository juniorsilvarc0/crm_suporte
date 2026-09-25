-- ============================================================================
-- Seed LOCAL (dev). Rodado pelo `supabase db reset` / `supabase start` DEPOIS das
-- migrations. NÃO é aplicado por `supabase db push` — então nada disso vai pra prod.
-- ============================================================================

-- 1) Acesso ao banco (DEV, espelhando produção).
--    O app lê/escreve server-side com a SERVICE key (que ignora RLS), então o
--    service_role recebe grant em tudo. O acesso anon ao chat (realtime no
--    browser) é feito por MIGRATION (chat_anon_realtime) — dev = produção. As
--    demais tabelas ficam protegidas por RLS (ligada nas migrations).
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- 2) Etapas do funil (board_columns) — 8 estágios canônicos do CRM.
insert into public.board_columns (key, label, color, position) values
  ('novo',           'Novo',           'violet',  1),
  ('em_atendimento', 'Em atendimento', 'blue',    2),
  ('qualificado',    'Qualificado',    'cyan',    3),
  ('agendado',       'Agendado',       'amber',   4),
  ('compareceu',     'Compareceu',     'teal',    5),
  ('cliente',        'Cliente',        'emerald', 6),
  ('recorrente',     'Recorrente',     'fuchsia', 7),
  ('perdido',        'Perdido',        'rose',    8)
on conflict (key) do nothing;

-- 3) Tags de exemplo.
insert into public.tags (id, name, color) values
  ('11111111-1111-1111-1111-111111111101', 'Quente',     'rose'),
  ('11111111-1111-1111-1111-111111111102', 'Indicação',  'emerald'),
  ('11111111-1111-1111-1111-111111111103', 'Instagram',  'fuchsia')
on conflict (id) do nothing;

-- 4) Leads de exemplo espalhados pelo funil.
insert into public.leads (id, name, phone, normalized_phone, email, source, status, tipo_ensaio, interesse, valor_estimado, created_at, last_message_at, qualificado_at, agendado_at) values
  ('22222222-2222-2222-2222-222222222201', 'Ana Prado',    '(27) 99911-0001', '5527999110001', 'ana@example.com',    'indicacao', 'novo',           'consulta',   'Avaliação inicial',   NULL,    now() - interval '2 hours',  NULL,                       NULL,                       NULL),
  ('22222222-2222-2222-2222-222222222202', 'Bruno Dias',   '(27) 99911-0002', '5527999110002', NULL,                 'anuncio',   'em_atendimento', 'consulta',   'Retorno',             NULL,    now() - interval '6 hours',  NULL,                       NULL,                       NULL),
  ('22222222-2222-2222-2222-222222222203', 'Carla Nunes',  '(27) 99911-0003', '5527999110003', 'carla@example.com',  'whatsapp',  'qualificado',    'proposta',   'Pacote completo',     1800.00, now() - interval '1 day',    now() - interval '20 hours', NULL,                       NULL),
  ('22222222-2222-2222-2222-222222222204', 'Diego Reis',   '(27) 99911-0004', '5527999110004', NULL,                 'agencia',   'agendado',       'reuniao',    'Fechamento',          2500.00, now() - interval '2 days',   now() - interval '2 days',   now() - interval '1 day',   now() - interval '20 hours'),
  ('22222222-2222-2222-2222-222222222205', 'Elaine Souza', '(27) 99911-0005', '5527999110005', 'elaine@example.com', 'indicacao', 'cliente',        'onboarding', 'Cliente ativo',       2500.00, now() - interval '5 days',   now() - interval '4 days',   now() - interval '4 days',  now() - interval '3 days'),
  ('22222222-2222-2222-2222-222222222206', 'Felipe Lima',  '(27) 99911-0006', '5527999110006', NULL,                 'anuncio',   'perdido',        'consulta',   'Sem retorno',         NULL,    now() - interval '7 days',   NULL,                       NULL,                       NULL)
on conflict (id) do nothing;

-- 5) Vincular tags a alguns leads.
insert into public.lead_tags (lead_id, tag_id) values
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111103'),
  ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111101')
on conflict do nothing;

-- 6) Agendamentos.
insert into public.appointments (id, lead_id, scheduled_at, duration_min, tipo_ensaio, status) values
  ('33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222204', now() + interval '1 day',  60, 'reuniao',    'agendado'),
  ('33333333-3333-3333-3333-333333333302', '22222222-2222-2222-2222-222222222205', now() - interval '3 days', 60, 'onboarding', 'compareceu')
on conflict (id) do nothing;

-- 7) Financeiro: contrato + pagamento + despesa.
insert into public.contracts (id, lead_id, package_name, total_amount, signal_amount, discount, status) values
  ('44444444-4444-4444-4444-444444444401', '22222222-2222-2222-2222-222222222205', 'Álbum + Photolivro 30 fotos', 2500.00, 500.00, 0, 'aberto')
on conflict (id) do nothing;

insert into public.payments (id, lead_id, contract_id, amount, method, installments, is_signal, status, paid_at) values
  ('55555555-5555-5555-5555-555555555501', '22222222-2222-2222-2222-222222222205', '44444444-4444-4444-4444-444444444401', 500.00, 'pix', 1, true, 'pago', now() - interval '3 days')
on conflict (id) do nothing;

insert into public.expenses (id, category, kind, description, amount, status, paid_at, recurring) values
  ('66666666-6666-6666-6666-666666666601', 'aluguel', 'fixa', 'Aluguel do estúdio', 1800.00, 'pago', now() - interval '2 days', true),
  ('66666666-6666-6666-6666-666666666602', 'marketing', 'variavel', 'Tráfego pago', 600.00, 'pendente', NULL, false)
on conflict (id) do nothing;

-- 8) Um log de integração de exemplo.
insert into public.integration_logs (provider, direction, action, status, payload) values
  ('n8n', 'inbound', 'lead.upsert', 'ok', '{"phone":"5527999110003"}'::jsonb)
on conflict do nothing;

-- 9) Usuário do dashboard para desenvolvimento local (login: admin@local / 123456).
--    Em produção, criar o usuário real com uma senha forte.
insert into public.app_users (email, name, password_hash, role) values
  ('admin@local', 'Administrador', extensions.crypt('123456', extensions.gen_salt('bf')), 'admin')
on conflict do nothing;
-- (app_users já é protegida pela sua migration: RLS ligada + revoke de anon.)
