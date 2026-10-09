import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { resolveTicketId } from "@/features/tickets/queries/get-api-ticket";
import { apiError } from "@/lib/api/v1/errors";
import { notFound, unavailable } from "@/lib/api/v1/responses";
import { parseTicketRef } from "@/lib/api/v1/tickets";
import type { Database } from "@/lib/supabase/types";

// Avisos ao cliente com claim/finalize (Fase 6c-4; guia: docs/GUIA-AGENTE-IA.md
// §5). Quem avisa reivindica um passo do ticket ANTES de mandar a mensagem e o
// fecha depois: só `claimed: true` autoriza o envio. O passo é escolhido por
// quem avisa — o `id` do evento (um aviso por evento) ou um nome fixo.

type Admin = SupabaseClient<Database>;

/** O mesmo formato que o check de `ticket_notices.step` aceita. */
export const NOTICE_STEP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export const noticeClaimBodySchema = z.strictObject({
  /** Quanto tempo a reivindicação segura o passo: 30 s a 15 min (padrão 120). */
  lease_seconds: z.int().min(30).max(900).optional(),
});

export const noticeFinalizeBodySchema = z.strictObject({
  claim_token: z.uuid(),
  outcome: z.enum(["sent", "failed"]),
  /** O motivo da falha, guardado até a próxima tentativa (até 500 caracteres). */
  error: z.string().trim().max(500).optional(),
});

export const noticeClaimResultSchema = z.discriminatedUnion("claimed", [
  z.strictObject({
    claimed: z.literal(true),
    claim_token: z.uuid(),
    lease_expires_at: z.string(),
    attempts: z.int().min(1),
  }),
  z.strictObject({
    claimed: z.literal(false),
    reason: z.enum(["already_sent", "in_progress"]),
    lease_expires_at: z.string().optional(),
    finalized_at: z.string().optional(),
  }),
]);

export const noticeFinalizeResultSchema = z.strictObject({
  finalized: z.literal(true),
  status: z.enum(["sent", "failed"]),
});

export type NoticeClaimResult = z.infer<typeof noticeClaimResultSchema>;
export type NoticeFinalizeResult = z.infer<typeof noticeFinalizeResultSchema>;

/**
 * O corpo do claim é opcional: sem corpo (ou vazio), vale o padrão. Corpo que
 * não é JSON é 400, como nas outras rotas.
 */
export async function readOptionalJsonBody(request: Request): Promise<{ data: unknown; error: null } | { data: null; error: "invalid_json" }> {
  const text = await request.text();
  if (!text.trim()) return { data: {}, error: null };
  try {
    return { data: JSON.parse(text) as unknown, error: null };
  } catch {
    return { data: null, error: "invalid_json" };
  }
}

export type NoticeTarget = { ok: true; ticketId: string; step: string } | { ok: false; response: Response };

/**
 * `{ref}` e `{step}` da rota. Protocolo que não existe já é 404 aqui; um uuid
 * que não existe, a própria RPC responde (P0002).
 */
export async function noticeTarget(
  supabase: Admin,
  requestId: string,
  params: { ref: string; step: string }
): Promise<NoticeTarget> {
  const ref = parseTicketRef(params.ref);
  if (!ref) return { ok: false, response: notFound(requestId, "Ticket não encontrado.") };
  if (!NOTICE_STEP_PATTERN.test(params.step)) {
    return {
      ok: false,
      response: apiError(requestId, 400, "validation_error", "Passo inválido.", {
        fields: {
          step: "Use até 128 caracteres entre letras, números, '_', '.', ':' e '-', começando por letra ou número.",
        },
      }),
    };
  }

  let ticketId: string | null;
  try {
    ticketId = await resolveTicketId(supabase, ref);
  } catch (error) {
    console.error(`[api/v1] ${requestId} ticket ref`, error);
    return { ok: false, response: unavailable(requestId, "o ticket") };
  }
  if (!ticketId) return { ok: false, response: notFound(requestId, "Ticket não encontrado.") };
  return { ok: true, ticketId, step: params.step };
}
