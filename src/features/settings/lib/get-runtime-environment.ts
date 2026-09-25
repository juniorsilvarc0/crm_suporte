import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_API_KEY_NAME,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
  type OpenAiTranscriptionModel,
  type TranscriptionModelConfig,
} from "@/features/settings/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

/**
 * Configuração de integração que o app lê do cofre (Vault).
 *
 * - **Catálogo:** só estes nomes são lidos. Ler outro é erro de tipo, não
 *   uma consulta ao cofre com nome montado em tempo de execução.
 * - **Sem env:** a regra do produto é "nenhuma credencial no código"; o env
 *   guarda só o bootstrap (Supabase, JWT). Variável de integração no env é
 *   ignorada, não usada como reserva.
 * - **Falha fechada:** cofre ilegível LANÇA `RuntimeEnvironmentUnavailableError`
 *   (quem chama responde 503). "Não consegui ler" não vira "não configurado".
 * - **Cache de 60 s**, zerado pela rota que grava no cofre. Com mais de uma
 *   instância, a outra enxerga a mudança em até 60 s.
 */
export const RUNTIME_ENVIRONMENT_CATALOG = [
  OPENAI_API_KEY_NAME,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
] as const;

export type RuntimeEnvironmentName = (typeof RUNTIME_ENVIRONMENT_CATALOG)[number];

type RuntimeEnvironmentValue = {
  value: string | null;
  source: "vault" | "none";
};

export class RuntimeEnvironmentUnavailableError extends Error {
  constructor(reason: string) {
    super(`cofre indisponível: ${reason}`);
    this.name = "RuntimeEnvironmentUnavailableError";
  }
}

const CACHE_TTL_MS = 60_000;
let cache: { values: Map<string, string>; expiresAt: number } | null = null;
/**
 * Sobe a cada invalidação. Uma leitura que começou ANTES de uma gravação no
 * cofre não pode repor o valor antigo no cache quando terminar — seria a
 * chave apagada (vazada) valendo por mais 60 s.
 */
let generation = 0;

/** Zera o cache. A rota que grava/apaga no cofre chama depois de gravar. */
export function invalidateRuntimeEnvironmentCache() {
  cache = null;
  generation += 1;
}

async function loadCatalog(): Promise<Map<string, string>> {
  if (cache && cache.expiresAt > Date.now()) return cache.values;
  if (!hasSupabaseServerEnv()) {
    throw new RuntimeEnvironmentUnavailableError("Supabase não configurado");
  }

  // Uma ida ao banco para o catálogo inteiro.
  const startedAt = generation;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_app_environment_variables", {
    p_names: [...RUNTIME_ENVIRONMENT_CATALOG],
  });
  if (error) throw new RuntimeEnvironmentUnavailableError(error.message);

  const values = new Map<string, string>();
  for (const row of data ?? []) {
    if (typeof row.value === "string" && row.value.length > 0) values.set(row.name, row.value);
  }
  if (generation === startedAt) cache = { values, expiresAt: Date.now() + CACHE_TTL_MS };
  return values;
}

export async function getRuntimeEnvironmentVariable(
  name: RuntimeEnvironmentName
): Promise<RuntimeEnvironmentValue> {
  const value = (await loadCatalog()).get(name) ?? null;
  return value ? { value, source: "vault" } : { value: null, source: "none" };
}

const transcriptionModelNames = new Set<string>(
  OPENAI_TRANSCRIPTION_MODELS.map((model) => model.value)
);

export async function getTranscriptionModelConfig(): Promise<TranscriptionModelConfig> {
  const configured = await getRuntimeEnvironmentVariable(OPENAI_TRANSCRIPTION_MODEL_NAME);

  if (configured.value && transcriptionModelNames.has(configured.value)) {
    return { value: configured.value as OpenAiTranscriptionModel, source: "vault" };
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
