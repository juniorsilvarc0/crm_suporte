-- appointments: quem fez o agendamento (atribuição para contabilização/comissão).
-- Aditiva e não-destrutiva. NULLABLE de propósito: agendamentos criados pela IA
-- (via /api/integracao/appointments) e os já existentes ficam com autor nulo =
-- "agendado pela IA / não atribuído". ON DELETE SET NULL: remover um usuário
-- nunca apaga o agendamento, só zera a autoria.
alter table public.appointments
  add column if not exists created_by_user_id uuid
    references public.app_users(id) on delete set null;

-- Acelera o relatório "quem agendou" (agregação por autor).
create index if not exists appointments_created_by_user_id_idx
  on public.appointments (created_by_user_id);
