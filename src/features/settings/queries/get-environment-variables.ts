import { getTranscriptionModelConfig } from "@/features/settings/lib/get-runtime-environment";
import {
  OPENAI_API_KEY_NAME,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
  type EnvironmentVariableListItem,
} from "@/features/settings/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

const ENVIRONMENT_FALLBACKS = [OPENAI_API_KEY_NAME] as const;

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

  const names = new Set(managed.map((variable) => variable.name));
  for (const name of ENVIRONMENT_FALLBACKS) {
    if (!names.has(name) && process.env[name]) {
      managed.push({
        id: null,
        name,
        source: "environment",
        createdAt: null,
        updatedAt: null,
      });
    }
  }

  return managed.sort((left, right) => left.name.localeCompare(right.name));
}

export { getTranscriptionModelConfig };
