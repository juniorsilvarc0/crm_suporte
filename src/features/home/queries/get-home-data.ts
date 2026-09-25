import type { HomeAppointment, HomePerson, HomeSummary } from "@/features/home/types";
import { comparePeopleForHome } from "@/features/home/lib/people-order";
import { PATIENT_SEX, type PatientSex } from "@/features/patients/types";
import { getTodayAppDateKey } from "@/lib/formatters/date";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

/** Etapas que significam "não está mais em acompanhamento". */
const CLOSED_STATUSES = ["perdido"];

/**
 * Quantas pessoas são lidas para cada vaga na tela.
 *
 * A consulta escolhe candidatos por recência, mas a tela ordena por urgência —
 * então o pool precisa ser maior que a lista para o aniversariante calado ter
 * chance de aparecer. Cinco cobre a clínica sem transformar a home numa
 * varredura da base.
 */
const CANDIDATE_FACTOR = 5;

/**
 * Pessoas da tela de Início: as mais recentes, já com o próximo agendamento
 * colado. Duas consultas em vez de join porque o próximo agendamento é o
 * PRIMEIRO futuro de cada pessoa — o banco não devolve isso num select simples
 * sem uma view, e a lista aqui é curta por desenho (§41 da especificação).
 */
export async function getHomePeople(limit = 12): Promise<HomePerson[]> {
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = createSupabaseServerClient();
    const { data: leads, error } = await supabase
      .from("leads")
      // `patients(birth_date)`: quem já virou paciente tem ficha, e é dela que
      // sai o aniversário. Lead sem ficha volta `patients: null` — normal.
      .select("id, name, phone, status, created_at, last_message_at, patients(birth_date)")
      .is("archived_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      // ⚠️ Busca um POOL maior do que cabe na tela, e não `limit` direto.
      // A ordem final (aniversariante, sessão mais próxima) é decidida depois,
      // em memória; cortar em 12 aqui deixaria de fora justamente a criança que
      // faz aniversário hoje mas cuja família não manda mensagem há semanas.
      .limit(limit * CANDIDATE_FACTOR);

    if (error) {
      console.error("getHomePeople", error.message);
      return [];
    }

    const rows = leads ?? [];
    if (rows.length === 0) return [];

    const ids = rows.map((lead) => lead.id as string);
    const { data: appointments, error: appointmentsError } = await supabase
      .from("appointments")
      .select("lead_id, scheduled_at")
      .in("lead_id", ids)
      .gte("scheduled_at", new Date().toISOString())
      .not("status", "in", "(cancelado,faltou)")
      .order("scheduled_at", { ascending: true });

    if (appointmentsError) {
      console.error("getHomePeople:appointments", appointmentsError.message);
    }

    // O primeiro de cada pessoa vence: a lista já vem ordenada por data.
    const nextByLead = new Map<string, string>();
    for (const row of appointments ?? []) {
      const leadId = row.lead_id as string | null;
      if (!leadId || nextByLead.has(leadId)) continue;
      nextByLead.set(leadId, row.scheduled_at as string);
    }

    const people: HomePerson[] = rows.map((lead) => {
      const patient = lead.patients as { birth_date?: string | null } | null;
      return {
        id: lead.id as string,
        name: (lead.name as string | null) ?? null,
        phone: (lead.phone as string | null) ?? null,
        status: (lead.status as string | null) ?? "novo",
        nextAppointmentAt: nextByLead.get(lead.id as string) ?? null,
        lastMessageAt: (lead.last_message_at as string | null) ?? null,
        birthDate: patient?.birth_date ?? null,
        createdAt: lead.created_at as string,
      };
    });

    // A ordem da tela é esta, não a do `order` da consulta: lá o critério é
    // recência, aqui é urgência. Só depois de ordenar é que se corta.
    return people.sort(comparePeopleForHome(getTodayAppDateKey())).slice(0, limit);
  } catch (error) {
    console.error("getHomePeople", error);
    return [];
  }
}

/** Agendamentos de um intervalo (a semana visível na grade). */
export async function getHomeAppointments(
  startIso: string,
  endIso: string
): Promise<HomeAppointment[]> {
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("appointments")
      // ⚠️ O sexo vem por DENTRO do lead: a chave é `leads.patient_id`, não
      // `patients.lead_id` (ver a migration dos pacientes). Quem ainda não virou
      // paciente não tem ficha, e aí `patients` volta nulo — é o caso normal do
      // lead recém-chegado, não erro.
      .select("id, lead_id, scheduled_at, duration_min, status, tipo_ensaio, leads(name, patients(sex))")
      .gte("scheduled_at", startIso)
      .lt("scheduled_at", endIso)
      .order("scheduled_at", { ascending: true })
      .limit(300);

    if (error) {
      console.error("getHomeAppointments", error.message);
      return [];
    }

    return (data ?? []).map((row) => {
      const lead = row.leads as
        | { name?: string | null; patients?: { sex?: string | null } | null }
        | null;
      const rawSex = lead?.patients?.sex ?? null;
      // A agenda guarda DURAÇÃO, não hora de término: o fim é derivado, e some
      // quando a duração não foi informada (a grade então usa o padrão dela).
      const duration = row.duration_min as number | null;
      const startsAt = row.scheduled_at as string;
      const endsAt = duration
        ? new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString()
        : null;

      return {
        id: row.id as string,
        leadId: (row.lead_id as string | null) ?? null,
        personName: lead?.name?.trim() || "Sem nome",
        startsAt,
        endsAt,
        status: (row.status as string | null) ?? "agendado",
        service: (row.tipo_ensaio as string | null) ?? null,
        // O banco só tem `check` na coluna; o tipo do app é mais estreito, e o
        // que não bate vira nulo em vez de virar cor errada na tela.
        sex: PATIENT_SEX.includes(rawSex as PatientSex) ? (rawSex as PatientSex) : null,
      };
    });
  } catch (error) {
    console.error("getHomeAppointments", error);
    return [];
  }
}

/** Contagens do cabeçalho da agenda: em acompanhamento e atendimentos de hoje. */
export async function getHomeSummary(
  todayStartIso: string,
  todayEndIso: string
): Promise<HomeSummary> {
  if (!hasSupabaseServerEnv()) return { active: 0, today: 0 };

  try {
    const supabase = createSupabaseServerClient();
    const [activeResult, todayResult] = await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .gte("scheduled_at", todayStartIso)
        .lt("scheduled_at", todayEndIso)
        .not("status", "in", "(cancelado)"),
    ]);

    if (activeResult.error) console.error("getHomeSummary:active", activeResult.error.message);
    if (todayResult.error) console.error("getHomeSummary:today", todayResult.error.message);

    return { active: activeResult.count ?? 0, today: todayResult.count ?? 0 };
  } catch (error) {
    console.error("getHomeSummary", error);
    return { active: 0, today: 0 };
  }
}
