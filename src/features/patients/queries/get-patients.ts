import { sanitizeLeadSearch } from "@/features/leads/lib/leads-search";
import { onlyDigits } from "@/features/patients/lib/documents";
import type { PaginatedPatients } from "@/features/patients/types";
import {
  APP_TIME_ZONE_OFFSET,
  addMonthsToAppMonthKey,
  getCurrentAppMonthKey,
} from "@/lib/formatters/date";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

export const PATIENTS_PAGE_SIZE = 20;

/**
 * Colunas da LISTA — explícitas de propósito. `select("*")` traria alergia,
 * filiação e endereço para uma tela que não mostra nada disso (ver o aviso em
 * `Database["public"]["Tables"]["patients"]`).
 */
export const PATIENT_LIST_COLUMNS =
  "id, full_name, social_name, birth_date, phone, cpf, city, state, insurance_name, promotion_source, created_at, archived_at";

type GetPatientsPageOptions = {
  page?: number;
  pageSize?: number;
  query?: string;
};

/**
 * Paginação real server-side (contagem via `count: "exact"` + `range`), no mesmo
 * molde de `getLeadsPage`. Arquivados ficam de fora: a lista é de quem está em
 * atendimento hoje.
 *
 * Leitura resiliente (AGENTS §4): erro loga e devolve página vazia em vez de
 * derrubar a tela.
 */
export async function getPatientsPage(
  options: GetPatientsPageOptions = {}
): Promise<PaginatedPatients> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, options.pageSize ?? PATIENTS_PAGE_SIZE));
  const empty: PaginatedPatients = { items: [], total: 0, page, pageSize, pageCount: 1 };

  if (!hasSupabaseServerEnv()) return empty;

  try {
    const supabase = createSupabaseServerClient();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("patients")
      .select(PATIENT_LIST_COLUMNS, { count: "exact" })
      .is("archived_at", null);

    const term = sanitizeLeadSearch(options.query ?? "");
    if (term) {
      // CPF é guardado só em dígitos (constraint no banco), então quem digita
      // com máscara precisa da versão limpa. O telefone tem as duas caras: o
      // cadastro grava dígitos, mas o paciente promovido de um lead herda o
      // telefone como o lead o guardou — por isso procuro o termo cru também.
      const digits = onlyDigits(term);
      const filters = [
        `full_name.ilike.%${term}%`,
        `social_name.ilike.%${term}%`,
        `phone.ilike.%${term}%`,
      ];

      if (digits.length >= 3) {
        filters.push(`cpf.ilike.%${digits}%`);
        if (digits !== term) filters.push(`phone.ilike.%${digits}%`);
      }

      query = query.or(filters.join(","));
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("getPatientsPage failed", error.message);
      return empty;
    }

    const total = count ?? 0;

    return {
      items: data ?? [],
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (error) {
    console.error("getPatientsPage threw", error);
    return empty;
  }
}

export type PatientsSummary = {
  total: number;
  comConvenio: number;
  novosNoMes: number;
};

/**
 * Os três números do topo da tela. `head: true` = só o COUNT vem do banco,
 * nenhuma linha trafega — o resumo fala da base inteira, não da página aberta.
 */
export async function getPatientsSummary(): Promise<PatientsSummary> {
  const empty: PatientsSummary = { total: 0, comConvenio: 0, novosNoMes: 0 };
  if (!hasSupabaseServerEnv()) return empty;

  try {
    const supabase = createSupabaseServerClient();
    const base = () =>
      supabase
        .from("patients")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null);

    // "No mês" é o mês do fuso da clínica, não o do servidor: cadastro feito às
    // 22h do dia 31 no Brasil já seria do mês seguinte em UTC.
    const monthKey = getCurrentAppMonthKey();
    const monthStartIso = `${monthKey}-01T00:00:00${APP_TIME_ZONE_OFFSET}`;
    const nextMonthStartIso = `${addMonthsToAppMonthKey(monthKey, 1)}-01T00:00:00${APP_TIME_ZONE_OFFSET}`;

    const [totalRes, insuranceRes, monthRes] = await Promise.all([
      base(),
      base().not("insurance_name", "is", null),
      base().gte("created_at", monthStartIso).lt("created_at", nextMonthStartIso),
    ]);

    return {
      total: totalRes.count ?? 0,
      comConvenio: insuranceRes.count ?? 0,
      novosNoMes: monthRes.count ?? 0,
    };
  } catch (error) {
    console.error("getPatientsSummary threw", error);
    return empty;
  }
}
