import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  ENVIRONMENT_VARIABLE_NAME_PATTERN,
  OPENAI_API_KEY_NAME,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
  type EnvironmentVariableSource,
  type OpenAiTranscriptionModel,
  type TranscriptionModelConfig,
} from "@/features/settings/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

type RuntimeEnvironmentValue = {
  value: string | null;
  source: EnvironmentVariableSource | "none";
};

const transcriptionModelNames = new Set<string>(
  OPENAI_TRANSCRIPTION_MODELS.map((model) => model.value)
);

function normalizeName(name: string) {
  const normalized = name.trim().toUpperCase();
  return ENVIRONMENT_VARIABLE_NAME_PATTERN.test(normalized) ? normalized : null;
}

export async function getManagedEnvironmentVariable(
  name: string
): Promise<string | null> {
  const normalized = normalizeName(name);
  if (!normalized || !hasSupabaseServerEnv()) return null;

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_app_environment_variable", {
      p_name: normalized,
    });
    if (error) {
      console.error("getManagedEnvironmentVariable failed", error.message);
      return null;
    }
    return typeof data === "string" && data.length > 0 ? data : null;
  } catch (error) {
    console.error("getManagedEnvironmentVariable threw", error);
    return null;
  }
}

export async function getRuntimeEnvironmentVariable(
  name: string
): Promise<RuntimeEnvironmentValue> {
  const normalized = normalizeName(name);
  if (!normalized) return { value: null, source: "none" };

  const managed = await getManagedEnvironmentVariable(normalized);
  if (managed !== null) return { value: managed, source: "vault" };

  const environment = process.env[normalized];
  if (environment) return { value: environment, source: "environment" };

  return { value: null, source: "none" };
}

export async function getTranscriptionModelConfig(): Promise<TranscriptionModelConfig> {
  const configured = await getRuntimeEnvironmentVariable(
    OPENAI_TRANSCRIPTION_MODEL_NAME
  );

  if (configured.value && transcriptionModelNames.has(configured.value)) {
    return {
      value: configured.value as OpenAiTranscriptionModel,
      source: configured.source === "none" ? "default" : configured.source,
    };
  }

  return { value: DEFAULT_OPENAI_TRANSCRIPTION_MODEL, source: "default" };
}

export async function getOpenAiTranscriptionConfig() {
  const [apiKey, model] = await Promise.all([
    getRuntimeEnvironmentVariable(OPENAI_API_KEY_NAME),
    getTranscriptionModelConfig(),
  ]);

  return { apiKey: apiKey.value, model: model.value };
}
