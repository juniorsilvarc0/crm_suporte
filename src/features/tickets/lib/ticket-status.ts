import type { ColorName } from "@/features/tags/schemas/colors";

// As 8 chaves de status do ticket (check ticket_statuses_key_check), na ordem
// de `position` do banco. As chaves são fixas; rótulo e cor são do admin (4f) e
// vêm do catálogo (getTicketCatalog). A matriz de transições também: nada aqui
// decide para onde um status vai. Neutro: a rota, a query e o client importam.
export const TICKET_STATUS_KEYS = [
  "novo",
  "em_triagem",
  "em_atendimento",
  "aguardando_cliente",
  "aguardando_interno",
  "resolvido",
  "fechado",
  "cancelado",
] as const;

export type TicketStatusKey = (typeof TICKET_STATUS_KEYS)[number];

// RECURSO: só quando o catálogo do banco falhou (getTicketCatalog devolve
// `statuses: null`). Espelha a semente da migration 20260925120900; o que o
// admin renomeou ou recoloriu aparece pelo catálogo, não por aqui.
export const TICKET_STATUS_FALLBACK_LABEL: Record<TicketStatusKey, string> = {
  novo: "Novo",
  em_triagem: "Em triagem",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando cliente",
  aguardando_interno: "Aguardando interno",
  resolvido: "Resolvido",
  fechado: "Fechado",
  cancelado: "Cancelado",
};

export const TICKET_STATUS_FALLBACK_COLOR: Record<TicketStatusKey, ColorName> = {
  novo: "sky",
  em_triagem: "violet",
  em_atendimento: "blue",
  aguardando_cliente: "amber",
  aguardando_interno: "orange",
  resolvido: "emerald",
  fechado: "slate",
  cancelado: "gray",
};

// `Object.hasOwn`, não `in`: `in` aceita chaves do protótipo ("constructor",
// "toString"), e o valor vem do banco, da URL ou do corpo da requisição.
export function isTicketStatus(value: unknown): value is TicketStatusKey {
  return typeof value === "string" && Object.hasOwn(TICKET_STATUS_FALLBACK_LABEL, value);
}
