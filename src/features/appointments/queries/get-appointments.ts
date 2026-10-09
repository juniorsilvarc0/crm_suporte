import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

import type { AppointmentListItem } from "@/features/appointments/types";

// Leitura resiliente da agenda (service role, servidor): erro vira [] + log, não
// derruba a página (padrão de getNotes/getTickets). Embeds com hint de FK pelo
// nome da constraint — `ticket_id` tem DUAS relações no gerador (tickets e a
// view ticket_queue), então sem o hint o PostgREST responde PGRST201.
const APPOINTMENT_SELECT = `
  id, kind, title, status, scheduled_at, duration_min, location, notes,
  ticket_id, customer_id, contact_id, assignee_id, created_by_user_id,
  created_at, updated_at,
  customer:customers!appointments_customer_id_fkey(id, legal_name, trade_name),
  contact:contacts!appointments_contact_id_fkey(id, name, phone),
  ticket:tickets!appointments_ticket_id_fkey(id, number, title, status),
  assignee:app_users!appointments_assignee_id_fkey(id, name)
`;

/** Os compromissos, do mais recente para o mais antigo. */
export async function getAppointments(): Promise<AppointmentListItem[]> {
  if (!hasSupabaseAdminEnv()) return [];
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("appointments")
      .select(APPOINTMENT_SELECT)
      .order("scheduled_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("[appointments] getAppointments", error.code, error.message);
      return [];
    }
    // Os embeds de FK (to-one) voltam como objeto; o gerador às vezes os tipa
    // como união, daí o cast — a forma em runtime é a de AppointmentListItem.
    return (data ?? []) as unknown as AppointmentListItem[];
  } catch (error) {
    console.error("[appointments] getAppointments lançou", error);
    return [];
  }
}

/** Os compromissos de um ticket, do mais próximo ao mais distante. */
export async function getTicketAppointments(ticketId: string): Promise<AppointmentListItem[]> {
  if (!hasSupabaseAdminEnv()) return [];
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("appointments")
      .select(APPOINTMENT_SELECT)
      .eq("ticket_id", ticketId)
      .order("scheduled_at", { ascending: true });
    if (error) {
      console.error("[appointments] getTicketAppointments", error.code, error.message);
      return [];
    }
    return (data ?? []) as unknown as AppointmentListItem[];
  } catch (error) {
    console.error("[appointments] getTicketAppointments lançou", error);
    return [];
  }
}
