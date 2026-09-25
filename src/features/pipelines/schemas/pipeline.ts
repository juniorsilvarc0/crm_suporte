import { z } from "zod";

import { isColorName, type ColorName } from "@/features/leads/schemas/colors";
import { localDateTimeToIso } from "@/lib/formatters/date";

/*
  Schemas de funil, etapa e card.

  Os formulários deste projeto são não-controlados: o `<form>` manda tudo o que
  renderiza via `Object.fromEntries(new FormData())`, então campo vazio chega
  como `""` — que significa "sem valor", não "string vazia". Todo campo
  opcional passa por um `preprocess` que transforma `""` em `null`; ausência
  continua sendo `undefined` = "não altere" (as rotas de PATCH podam `undefined`
  antes de gravar, igual `PATCH /api/patients/[id]`).
*/

// --- Primitivos reaproveitados pelos três schemas ----------------------------

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max, `No máximo ${max} caracteres.`).nullish()
  );

const optionalUuid = (message: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().uuid(message).nullish()
  );

/**
 * Cor da marca: **nome** do design system (`src/features/leads/schemas/colors.ts`),
 * nunca hex — a tela monta classe literal a partir dele (UI.md §3).
 */
const colorWithFallback = (fallback: ColorName) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : fallback),
    z.string().refine(isColorName, "Cor inválida.")
  );

const optionalColor = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().refine(isColorName, "Cor inválida.").optional()
);

/** Valor em reais. Vazio = sem valor; `deals` e `pipeline_cards` aceitam nulo. */
const optionalAmount = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.coerce
    .number({ message: "Informe um valor válido." })
    .nonnegative("O valor não pode ser negativo.")
    .nullish()
);

/**
 * Prazo do card. Aceita `2026-08-20` (input de data) e `2026-08-20T14:30`
 * (input datetime-local) e grava ISO no fuso da clínica — a conversão é a
 * mesma de follow-ups (`localDateTimeToIso`), para não nascer uma terceira
 * interpretação de data neste repositório.
 */
const optionalDateTime = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .transform((value) => localDateTimeToIso(value))
    .refine((value) => value !== "", "Data inválida.")
    .nullish()
);

// --- Etapas ------------------------------------------------------------------

/**
 * `key` da etapa a partir do rótulo. Mesma regra do `slugify` de
 * `/api/board-columns` — que é local àquele arquivo e não pode ser importado.
 * A chave é única **por funil** (índice `board_columns_pipeline_key_uidx`), e a
 * rota resolve colisão com sufixo numérico.
 */
export function slugifyStageKey(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "etapa"
  );
}

/**
 * Chave livre a partir do rótulo, evitando as que o funil já usa. `taken`
 * recebe a chave escolhida — chamar em sequência para uma lista de etapas
 * nunca gera duas iguais.
 */
export function buildStageKey(label: string, taken: Set<string>): string {
  const base = slugifyStageKey(label);
  let key = base;
  let attempt = 2;
  while (taken.has(key)) {
    key = `${base}-${attempt}`;
    attempt += 1;
  }
  taken.add(key);
  return key;
}

const stageType = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : "open"),
  z.enum(["open", "won", "lost"], { message: "Situação inválida." })
);

export const pipelineStageInputSchema = z.object({
  /**
   * Presente = etapa que **já existe** e vai ser atualizada. A `key` dela é
   * preservada: os cards apontam para a chave, então re-derivá-la a partir de
   * um rótulo renomeado deixaria cada card órfão numa coluna que sumiu.
   */
  id: optionalUuid("Etapa inválida."),
  label: z.string().trim().min(1, "Informe o nome da etapa.").max(40, "No máximo 40 caracteres."),
  color: colorWithFallback("slate"),
  /** Opcional: quem manda na ordem é a posição do item na lista. */
  position: z.coerce.number().int().min(0).optional(),
  stage_type: stageType,
});

export const pipelineStagesSchema = z.object({
  stages: z
    .array(pipelineStageInputSchema)
    .min(1, "O funil precisa de pelo menos uma etapa.")
    .max(20, "No máximo 20 etapas por funil."),
});

/**
 * Etapas de um funil recém-criado que não veio com lista própria.
 *
 * Funil sem etapa nenhuma é funil quebrado: o gatilho do banco recusa qualquer
 * card, e a tela não teria coluna para desenhar. Três etapas genéricas deixam o
 * funil utilizável no primeiro segundo e são renomeáveis pela tela de etapas.
 */
export const DEFAULT_PIPELINE_STAGES: {
  label: string;
  color: ColorName;
  stage_type: "open" | "won" | "lost";
}[] = [
  { label: "A fazer", color: "slate", stage_type: "open" },
  { label: "Em andamento", color: "sky", stage_type: "open" },
  { label: "Concluído", color: "emerald", stage_type: "won" },
];

// --- Funil -------------------------------------------------------------------

export const createPipelineSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do funil.").max(60, "No máximo 60 caracteres."),
  description: optionalText(240),
  color: colorWithFallback("sky"),
  /** Etapas iniciais. Sem elas, a rota grava `DEFAULT_PIPELINE_STAGES`. */
  stages: z.array(pipelineStageInputSchema).max(20, "No máximo 20 etapas por funil.").optional(),
});

/**
 * `kind` não entra: o funil nativo é único e definitivo (índice único no
 * banco). Deixar o cliente escolher o tipo é o caminho mais curto para
 * transformar um funil comum em nativo por engano.
 */
export const updatePipelineSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do funil.").max(60, "No máximo 60 caracteres.").optional(),
  description: optionalText(240),
  color: optionalColor,
  position: z.coerce.number().int().min(0).optional(),
});

// --- Cards -------------------------------------------------------------------

export const createPipelineCardSchema = z.object({
  pipeline_id: z.string().uuid("Funil inválido."),
  stage: z.string().trim().min(1, "Escolha a etapa."),
  /**
   * Obrigatório — diferente de `deals`, onde o lead sempre dá nome ao card.
   * Aqui o card pode não ter pessoa nenhuma, e sem título nada o identifica.
   */
  title: z.string().trim().min(1, "Informe o título do card.").max(160, "No máximo 160 caracteres."),
  description: optionalText(2000),
  lead_id: optionalUuid("Lead inválido."),
  patient_id: optionalUuid("Paciente inválido."),
  assigned_to_user_id: optionalUuid("Responsável inválido."),
  amount: optionalAmount,
  due_at: optionalDateTime,
});

/**
 * `pipeline_id` fica de fora: mudar o funil de um card significaria mudar de
 * etapa junto (a `key` só vale dentro do funil de origem). Se um dia isso for
 * preciso, é rota própria — não efeito colateral de um PATCH parcial.
 */
export const updatePipelineCardSchema = z.object({
  stage: z.string().trim().min(1, "Escolha a etapa.").optional(),
  /** O arraste do kanban manda `stage` + `position` juntos. */
  position: z.coerce.number().int().min(0).optional(),
  title: z.string().trim().min(1, "Informe o título do card.").max(160, "No máximo 160 caracteres.").optional(),
  description: optionalText(2000),
  lead_id: optionalUuid("Lead inválido."),
  patient_id: optionalUuid("Paciente inválido."),
  assigned_to_user_id: optionalUuid("Responsável inválido."),
  amount: optionalAmount,
  due_at: optionalDateTime,
});

export type PipelineStageInput = z.infer<typeof pipelineStageInputSchema>;
export type PipelineStagesInput = z.infer<typeof pipelineStagesSchema>;
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
export type CreatePipelineCardInput = z.infer<typeof createPipelineCardSchema>;
export type UpdatePipelineCardInput = z.infer<typeof updatePipelineCardSchema>;
