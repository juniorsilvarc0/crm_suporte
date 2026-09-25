import { getTranscriptionModelConfig as readTranscriptionModelConfig } from "@/features/settings/lib/get-runtime-environment";
import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
  type EnvironmentVariableListItem,
  type TranscriptionModelConfig,
} from "@/features/settings/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

export async function getEnvironmentVariables(): Promise<EnvironmentVariableListItem[]> {
  const managed: EnvironmentVariableListItem[] = [];

  if (hasSupabaseServerEnv()) {
    try {
      const supabase = createSupabaseServerClient();
      const { data, error } = await supabase
        .from("app_environment_variables")
        .select("id, name, created_at, updated_at")
        .neq("name", OPENAI_TRANSCRIPTION_MODEL_NAME)
        .order("name", { ascending: true });

      if (error) {
        console.error("getEnvironmentVariables failed", error.message);
      } else {
        managed.push(
          ...(data ?? []).map((variable) => ({
            id: variable.id,
            name: variable.name,
            source: "vault" as const,
            createdAt: variable.created_at,
            updatedAt: variable.updated_at,
          }))
        );
      }
    } catch (error) {
      console.error("getEnvironmentVariables threw", error);
    }
  }

  // Só o cofre: variável de integração no env não é lida pelo app
  // (get-runtime-environment), então listá-la aqui mentiria para o admin.
  return managed.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Modelo de transcrição para a tela de Configurações. Cofre ilegível mostra o
 * padrão e loga, em vez de derrubar a página inteira (leitura resiliente).
 */
export async function getTranscriptionModelConfig(): Promise<TranscriptionModelConfig> {
  try {
    return await readTranscriptionModelConfig();
  } catch (error) {
    console.error("getTranscriptionModelConfig failed", error);
    return { value: DEFAULT_OPENAI_TRANSCRIPTION_MODEL, source: "default" };
  }
}
