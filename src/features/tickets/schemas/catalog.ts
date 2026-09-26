import { z } from "zod";

import { isColorName } from "@/features/tags/schemas/colors";
import { isPgSafeText, PG_UNSAFE_TEXT_MESSAGE } from "@/features/tickets/schemas/ticket";
import { UUID_RE } from "@/lib/validation/uuid";

// Compartilhado entre os gerenciadores de /app/configuracoes/atendimento (4f) e
// as rotas de admin dos catálogos: fila (products), categoria, SLA e status. O
// banco confere de novo (checks, o trigger guard_ticket_category e os únicos por
// nome). .strict() em todos: o que não é editável (a chave e o modo do status,
// a posição, a fila e a mãe de uma categoria que já existe) responde 400 em vez
// de ser ignorado em silêncio.

// Texto vazio (ou só espaços, depois do trim) = "sem valor": vira null, porque
// o banco recusa texto em branco. 2º uso (schemas/ticket.ts): duplicado.
function blankToNull(value: string | null): string | null {
  return value ? value : null;
}

// Referência que pode ser tirada: uuid, null ou "" (seleção vazia) → null.
// 2º uso (schemas/ticket.ts): duplicado.
function nullableRef(message: string) {
  return z
    .string(message)
    .nullable()
    .transform(blankToNull)
    .pipe(z.string(message).regex(UUID_RE, message).nullable());
}

// PATCH sem nenhum campo (ou só com chaves ausentes) não grava nada: 400.
function hasSomeField(value: Record<string, unknown>): boolean {
  return Object.values(value).some((field) => field !== undefined);
}

const NOTHING_TO_UPDATE = "Nada para atualizar.";

// Nome de fila e de categoria: o teto dos checks (80) e o mínimo de POST
// /api/products.
function catalogName(required: string) {
  return z
    .string(required)
    .trim()
    .min(2, "Use ao menos 2 caracteres.")
    .max(80, "Máximo de 80 caracteres.")
    .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE);
}

// Nome da paleta (features/tags/schemas/colors.ts); o banco só confere o formato.
const color = z.string("Cor inválida.").trim().refine(isColorName, "Cor inválida.");

// Arquivar (true) e reativar (false). A data do arquivamento é do servidor.
const archived = z.boolean("Valor inválido.");

// PATCH /api/products/[id]: a fila. Vazio no nicho vira null (o banco recusa
// nicho em branco); null tira o nicho.
export const productPatchSchema = z
  .object({
    name: catalogName("Informe o nome da fila.").optional(),
    niche: z
      .string("Nicho inválido.")
      .trim()
      .max(80, "Máximo de 80 caracteres.")
      .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE)
      .nullable()
      .transform(blankToNull)
      .optional(),
    color: color.optional(),
    archived: archived.optional(),
  })
  .strict()
  .refine(hasSomeField, NOTHING_TO_UPDATE);

// POST /api/ticket-categories. Sem fila = categoria geral; com mãe = subcategoria
// (2 níveis, da mesma fila da mãe: o trigger confere e responde
// CATEGORY_PRODUCT_MISMATCH). Ausente e "" viram null.
export const ticketCategoryCreateSchema = z
  .object({
    name: catalogName("Informe o nome da categoria."),
    product_id: nullableRef("Fila inválida.").default(null),
    parent_id: nullableRef("Categoria mãe inválida.").default(null),
  })
  .strict();

// PATCH /api/ticket-categories/[id]: nome, arquivar e reativar. A fila e a mãe
// não mudam depois de criada (sem grant de UPDATE nelas).
export const ticketCategoryPatchSchema = z
  .object({
    name: catalogName("Informe o nome da categoria.").optional(),
    archived: archived.optional(),
  })
  .strict()
  .refine(hasSomeField, NOTHING_TO_UPDATE);

// Minutos corridos (24/7), com os limites de sla_policies_*_check (1 minuto a
// 1 ano). A tela mostra h:min e envia minutos.
const minutes = z
  .number("Informe os minutos.")
  .int("Use minutos inteiros.")
  .min(1, "Use de 1 a 525.600 minutos.")
  .max(525600, "Use de 1 a 525.600 minutos.");

// PATCH /api/sla-policies/[priority]. Vale para os tickets abertos daqui em
// diante: o ticket guarda o snapshot dos minutos e do aviso. A ordem (1ª
// resposta ≤ solução) só é conferida aqui quando os dois vêm; com um só, o
// banco a confere contra o valor gravado (sla_policies_order_check).
export const slaPolicyPatchSchema = z
  .object({
    first_response_minutes: minutes.optional(),
    resolution_minutes: minutes.optional(),
    warn_pct: z
      .number("Informe o percentual.")
      .int("Use um número inteiro.")
      .min(1, "Use de 1 a 99%.")
      .max(99, "Use de 1 a 99%.")
      .optional(),
  })
  .strict()
  .refine(hasSomeField, NOTHING_TO_UPDATE)
  .superRefine((value, ctx) => {
    if (
      value.first_response_minutes !== undefined &&
      value.resolution_minutes !== undefined &&
      value.first_response_minutes > value.resolution_minutes
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["first_response_minutes"],
        message: "A 1ª resposta não pode ter prazo maior que a solução.",
      });
    }
  });

// PATCH /api/ticket-statuses/[key]: rótulo e cor. Modo do SLA, terminal e
// posição são da migration (os CHECKs de tickets dependem deles) e o .strict()
// os recusa.
export const ticketStatusPatchSchema = z
  .object({
    label: z
      .string("Informe o rótulo.")
      .trim()
      .min(2, "Use ao menos 2 caracteres.")
      .max(40, "Máximo de 40 caracteres.")
      .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE)
      .optional(),
    color: color.optional(),
  })
  .strict()
  .refine(hasSomeField, NOTHING_TO_UPDATE);

/**
 * Erro de raiz não entra em `fieldErrors`: sem isto a tela receberia "Revise os
 * campos destacados." sem nenhum campo destacado. Cobre o PATCH vazio (refine
 * dos schemas) e a chave recusada pelo `.strict()` (ex.: sla_mode). 3º uso
 * (api/customers/[id], api/tickets/[id]): exportado daqui para as 4 rotas de
 * catálogo; juntar as três cópias num lib neutro é um PR à parte.
 */
export function catalogRootErrorMessage(error: z.ZodError): string | null {
  const root = error.issues.find((issue) => issue.path.length === 0);
  if (root?.code === "custom") return root.message;
  if (root?.code === "unrecognized_keys") {
    return `Campo que não pode ser alterado por aqui: ${root.keys.join(", ")}.`;
  }
  return null;
}

// Values = o que o formulário edita (z.input); Input = o que a rota grava
// depois do parse (z.output).
export type ProductPatchValues = z.input<typeof productPatchSchema>;
export type ProductPatchInput = z.output<typeof productPatchSchema>;
export type TicketCategoryCreateValues = z.input<typeof ticketCategoryCreateSchema>;
export type TicketCategoryCreateInput = z.output<typeof ticketCategoryCreateSchema>;
export type TicketCategoryPatchValues = z.input<typeof ticketCategoryPatchSchema>;
export type TicketCategoryPatchInput = z.output<typeof ticketCategoryPatchSchema>;
export type SlaPolicyPatchValues = z.input<typeof slaPolicyPatchSchema>;
export type SlaPolicyPatchInput = z.output<typeof slaPolicyPatchSchema>;
export type TicketStatusPatchValues = z.input<typeof ticketStatusPatchSchema>;
export type TicketStatusPatchInput = z.output<typeof ticketStatusPatchSchema>;
