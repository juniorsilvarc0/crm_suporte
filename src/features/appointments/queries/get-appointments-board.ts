import type { AppointmentBoardItem } from "@/features/appointments/types";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

type GetAppointmentsBoardOptions = {
  startIso?: string;
  endIso?: string;
};

export async function getAppointmentsBoard(
  options: GetAppointmentsBoardOptions = {}
): Promise<AppointmentBoardItem[]> {
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = createSupabaseServerClient();
    let query = supabase
      .from("appointments")
      .select("*, leads(id, name, phone, email, instagram_user, status, source, tipo_ensaio, interesse, agencia_nome, modelo_nome, is_recorrente, valor_estimado, notes, created_at, last_message_at)")
      .order("scheduled_at", { ascending: true })
      .limit(200);

    if (options.startIso) {
      query = query.gte("scheduled_at", options.startIso);
    }

    if (options.endIso) {
      query = query.lt("scheduled_at", options.endIso);
    }

    const { data, error } = await query;

    if (error) {
      console.error("getAppointmentsBoard", error.message);
      return [];
    }

    return (data ?? []).map((appointment) => ({
      kind: "appointment" as const,
      appointment,
    }));
  } catch (error) {
    console.error("getAppointmentsBoard threw", error);
    return [];
  }
}
