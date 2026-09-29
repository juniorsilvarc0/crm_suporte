import { z } from "zod";

import type { ProductOption } from "@/features/products/types";
import type {
  TicketCategoryOption,
  TicketSlaPolicy,
  TicketStatusOption,
  TicketTeamMember,
  TicketTransition,
} from "@/features/tickets/types";

// Catálogos da API v1 (PR 6a do docs/PLANO-FASE-5.md). DTO campo a campo, em
// snake_case e estável: nada de cor ou posição de tela que o integrador não
// precisa, e nada que mude quando a tela mudar. Os schemas alimentam o OpenAPI
// e os testes das rotas.

export const productSchema = z.strictObject({ id: z.string(), name: z.string(), niche: z.string().nullable() });
export const ticketCategorySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  product_id: z.string().nullable(),
  parent_id: z.string().nullable(),
});
export const ticketStatusSchema = z.strictObject({
  key: z.string(),
  label: z.string(),
  sla_mode: z.string(),
  is_terminal: z.boolean(),
  /** Para onde este status pode ir (a matriz do banco). */
  transitions: z.array(z.string()),
});
export const slaPolicySchema = z.strictObject({
  priority: z.string(),
  rank: z.number().int().describe("Ordem de urgência: maior = mais urgente (baixa=1 … critica=4)."),
  first_response_minutes: z.number().int(),
  resolution_minutes: z.number().int(),
  warn_pct: z.number().int(),
});
export const assignableUserSchema = z.strictObject({ id: z.string(), name: z.string() });

export const listOf = <T extends z.ZodType>(item: T) => z.strictObject({ ok: z.literal(true), data: z.array(item) });

export function toProduct(product: ProductOption): z.infer<typeof productSchema> {
  return { id: product.id, name: product.name, niche: product.niche };
}

export function toTicketCategory(category: TicketCategoryOption): z.infer<typeof ticketCategorySchema> {
  return {
    id: category.id,
    name: category.name,
    product_id: category.product_id,
    parent_id: category.parent_id,
  };
}

/** Status na ordem do quadro, cada um com os destinos permitidos (na mesma ordem). */
export function toTicketStatuses(
  statuses: TicketStatusOption[],
  transitions: TicketTransition[]
): z.infer<typeof ticketStatusSchema>[] {
  return [...statuses]
    .sort((a, b) => a.position - b.position)
    .map((status) => ({
      key: status.key,
      label: status.label,
      sla_mode: status.sla_mode,
      is_terminal: status.is_terminal,
      transitions: transitions.filter((t) => t.from_status === status.key).map((t) => t.to_status),
    }));
}

export function toSlaPolicy(policy: TicketSlaPolicy): z.infer<typeof slaPolicySchema> {
  return {
    priority: policy.priority,
    rank: policy.rank,
    first_response_minutes: policy.first_response_minutes,
    resolution_minutes: policy.resolution_minutes,
    warn_pct: policy.warn_pct,
  };
}

/** Só quem pode receber ticket: ativo. Sem e-mail, papel nem foto. */
export function toAssignableUsers(team: TicketTeamMember[]): z.infer<typeof assignableUserSchema>[] {
  return team.filter((user) => user.is_active).map((user) => ({ id: user.id, name: user.name }));
}
