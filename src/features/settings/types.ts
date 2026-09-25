export const APP_USER_ROLES = ["admin", "member", "paid_traffic"] as const;

export type AppUserRole = (typeof APP_USER_ROLES)[number];

export function isAppUserRole(value: unknown): value is AppUserRole {
  return APP_USER_ROLES.some((role) => role === value);
}

// Usuário do dashboard exposto à aplicação — nunca inclui password_hash.
export type AppUser = {
  id: string;
  email: string;
  name: string;
  is_active: boolean;
  role: AppUserRole;
  avatar_url: string | null;
  avatar_color: string;
  must_change_password: boolean;
  apelido_atendimento: string | null;
  assinar_mensagens: boolean;
  created_at: string;
};

export const appUserRoleLabel: Record<AppUserRole, string> = {
  admin: "Administrador",
  member: "Membro",
  paid_traffic: "Tráfego pago",
};

export const appUserRoleOptions: ReadonlyArray<{
  value: AppUserRole;
  label: string;
}> = [
  { value: "member", label: "Membro — acessa a operação do CRM" },
  { value: "paid_traffic", label: "Tráfego pago — acessa somente Rastreamento" },
  { value: "admin", label: "Administrador — gerencia toda a equipe" },
];

// Token de API exposto à UI — nunca inclui o token em texto puro nem o hash.
export type ApiTokenListItem = {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export const OPENAI_API_KEY_NAME = "OPENAI_API_KEY";
export const OPENAI_TRANSCRIPTION_MODEL_NAME = "OPENAI_TRANSCRIPTION_MODEL";
export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = "whisper-1";

export const OPENAI_TRANSCRIPTION_MODELS = [
  { value: "whisper-1", label: "Whisper 1 — compatibilidade" },
  { value: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe — econômico" },
  { value: "gpt-4o-transcribe", label: "GPT-4o Transcribe — maior precisão" },
  { value: "gpt-transcribe", label: "GPT Transcribe — nova geração" },
] as const;

export type OpenAiTranscriptionModel =
  (typeof OPENAI_TRANSCRIPTION_MODELS)[number]["value"];

export type EnvironmentVariableSource = "vault" | "environment";

export type EnvironmentVariableListItem = {
  id: string | null;
  name: string;
  source: EnvironmentVariableSource;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TranscriptionModelConfig = {
  value: OpenAiTranscriptionModel;
  source: "vault" | "environment" | "default";
};
