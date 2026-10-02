import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_API_KEY_NAME,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
  RELAY_SIGNING_SECRET_NAME,
  RUNTIME_ENVIRONMENT_NAMES,
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
 * - **A chave de assinatura do relay fica FORA do cache:** ela só é lida na
 *   hora (`readRuntimeEnvironmentVariable`). No cache, a chave trocada ou
 *   removida seguiria na memória da outra réplica, e uma leitura por ele
 *   assinaria com a chave antiga.
 */
export const RUNTIME_ENVIRONMENT_CATALOG = RUNTIME_ENVIRONMENT_NAMES;

export type RuntimeEnvironmentName = (typeof RUNTIME_ENVIRONMENT_CATALOG)[number];

/** O que pode ser lido pelo cache: o catálogo sem a chave de assinatura do relay. */
export type CachedEnvironmentName = Exclude<RuntimeEnvironmentName, typeof RELAY_SIGNING_SECRET_NAME>;

const CACHED_NAMES = RUNTIME_ENVIRONMENT_CATALOG.filter(
  (name): name is CachedEnvironmentName => name !== RELAY_SIGNING_SECRET_NAME
);
const CACHED = new Set<string>(CACHED_NAMES);

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
    p_names: CACHED_NAMES,
  });
  if (error) throw new RuntimeEnvironmentUnavailableError(error.message);

  const values = new Map<string, string>();
  for (const row of data ?? []) {
    // Só o que foi pedido entra no cache: uma linha de carona (a chave de
    // assinatura, por exemplo) não fica na memória da réplica.
    if (!CACHED.has(row.name)) continue;
    if (typeof row.value === "string" && row.value.length > 0) values.set(row.name, row.value);
  }
  if (generation === startedAt) cache = { values, expiresAt: Date.now() + CACHE_TTL_MS };
  return values;
}

export async function getRuntimeEnvironmentVariable(
  name: CachedEnvironmentName
): Promise<RuntimeEnvironmentValue> {
  const value = (await loadCatalog()).get(name) ?? null;
  return value ? { value, source: "vault" } : { value: null, source: "none" };
}

/**
 * Uma variável do catálogo lida AGORA, sem o cache: para o que não pode valer
 * com atraso entre as réplicas. Com o cache, trocar a chave de assinatura do
 * relay deixaria uma réplica assinando com a antiga (ou sem chave) por até
 * 60 s. Custa uma ida ao banco por chamada. Falha fechada, como o resto.
 */
export async function readRuntimeEnvironmentVariable(
  name: RuntimeEnvironmentName
): Promise<string | null> {
  if (!hasSupabaseServerEnv()) {
    throw new RuntimeEnvironmentUnavailableError("Supabase não configurado");
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_app_environment_variable", { p_name: name });
  if (error) throw new RuntimeEnvironmentUnavailableError(error.message);
  return typeof data === "string" && data.length > 0 ? data : null;
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
