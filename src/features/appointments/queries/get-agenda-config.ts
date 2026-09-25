import {
  normalizeAgendaBlock,
  type AgendaBlock,
} from "@/features/appointments/lib/agenda-blocks";
import {
  emptyAgendaConfig,
  emptyAgendaHours,
  normalizeTimes,
  type AgendaConfig,
  type AgendaHours,
} from "@/features/appointments/lib/agenda-config";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

/**
 * Tipos de atendimento, unidades e grade de horários — as três coisas que a
 * clínica configura e que o modal de agendamento consome.
 *
 * Leitura resiliente, como `getDeals` e `getProcedures`: erro loga e devolve
 * vazio. A tela de agendamento não pode cair porque uma tabela de configuração
 * não respondeu — sem catálogo, os campos aparecem vazios e o operador ainda
 * consegue marcar a consulta.
 */
export async function getAgendaConfig(): Promise<AgendaConfig> {
  if (!hasSupabaseAdminEnv()) return emptyAgendaConfig();

  try {
    const supabase = createSupabaseAdminClient();
    // Só o que ainda importa: bloqueio que já terminou não muda decisão
    // nenhuma e só faria a lista crescer para sempre.
    const horizonte = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

    const [types, units, hours, blocks] = await Promise.all([
      supabase
        .from("appointment_types")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("clinic_units")
        .select("id, name, address")
        .is("archived_at", null)
        .order("name"),
      supabase.from("agenda_hours").select("weekday, times"),
      supabase
        .from("agenda_blocks")
        .select("id, starts_at, ends_at, all_day, reason")
        .gte("ends_at", horizonte)
        .order("starts_at"),
    ]);

    if (types.error) console.error("getAgendaConfig types", types.error.message);
    if (units.error) console.error("getAgendaConfig units", units.error.message);
    if (hours.error) console.error("getAgendaConfig hours", hours.error.message);
    if (blocks.error) console.error("getAgendaConfig blocks", blocks.error.message);

    return {
      types: types.data ?? [],
      units: units.data ?? [],
      hours: toAgendaHours(hours.data ?? []),
      blocks: toAgendaBlocks(blocks.data ?? []),
    };
  } catch (error) {
    console.error("getAgendaConfig threw", error);
    return emptyAgendaConfig();
  }
}

/**
 * Linhas por dia da semana → vetor de 7 posições.
 *
 * O vetor fixo é o que permite `hours[weekday]` na tela sem procurar linha. Dia
 * ausente vira lista vazia, então uma grade parcialmente configurada não quebra
 * o índice.
 */
export function toAgendaHours(rows: { weekday: number; times: string[] | null }[]): AgendaHours {
  const hours = emptyAgendaHours();
  for (const row of rows) {
    if (row.weekday < 0 || row.weekday > 6) continue;
    hours[row.weekday] = normalizeTimes(row.times ?? []);
  }
  return hours;
}

export function toAgendaBlocks(
  rows: {
    id: string;
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    reason: string | null;
  }[]
): AgendaBlock[] {
  return rows.map((row) =>
    normalizeAgendaBlock({
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allDay: row.all_day,
      reason: row.reason,
    })
  );
}
