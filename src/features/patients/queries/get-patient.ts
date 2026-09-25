import type { Patient } from "@/features/patients/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

/**
 * Cadastro completo de um paciente. Devolve a linha inteira — inclusive CPF,
 * filiação e informação de saúde: use só em server component/rota e filtre o
 * que vai para o cliente.
 *
 * Arquivado também volta: a ficha continua existindo para o histórico.
 */
export async function getPatientById(id: string): Promise<Patient | null> {
  if (!hasSupabaseServerEnv()) return null;

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("getPatientById failed", error.message);
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("getPatientById threw", error);
    return null;
  }
}

/**
 * O paciente por trás de um lead. A chave mora no lead (`leads.patient_id`,
 * N leads → 1 paciente), então o caminho é lead → paciente, nunca o contrário.
 *
 * `null` quando o lead ainda não foi promovido.
 */
export async function getPatientByLeadId(leadId: string): Promise<Patient | null> {
  if (!hasSupabaseServerEnv()) return null;

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("leads")
      .select("patient_id")
      .eq("id", leadId)
      .maybeSingle();

    if (error) {
      console.error("getPatientByLeadId failed", error.message);
      return null;
    }

    if (!data?.patient_id) return null;

    return getPatientById(data.patient_id);
  } catch (error) {
    console.error("getPatientByLeadId threw", error);
    return null;
  }
}
