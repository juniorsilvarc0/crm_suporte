import { claimTicketNotice } from "@/features/tickets/server/ticket-notices";
import { apiError } from "@/lib/api/v1/errors";
import { noticeClaimBodySchema, noticeTarget, readOptionalJsonBody } from "@/lib/api/v1/notices";
import { apiOk, invalidInput, notFound } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reivindica o aviso `{step}` do ticket ANTES de mandar a mensagem ao cliente.
 * `claimed: true` (com o `claim_token`) é a única resposta que autoriza o
 * envio; `claimed: false` diz por quê (`already_sent`, `in_progress`). Sem
 * Idempotency-Key de propósito: repetir a resposta daria `claimed: true` a
 * duas entregas do mesmo evento.
 */
export const POST = withApi<{ ref: string; step: string }>(
  { route: "/api/v1/tickets/[ref]/notices/[step]/claim", scopes: ["notices:claim"] },
  async ({ request, params, requestId, supabase, token }) => {
    const target = await noticeTarget(supabase, requestId, params);
    if (!target.ok) return target.response;

    const body = await readOptionalJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = noticeClaimBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    const result = await claimTicketNotice(supabase, {
      ticketId: target.ticketId,
      step: target.step,
      tokenId: token.id,
      leaseSeconds: parsed.data.lease_seconds,
    });
    if (!result.ok) {
      if (result.error === "ticket_not_found") return notFound(requestId, "Ticket não encontrado.");
      if (result.error === "invalid") return apiError(requestId, 400, "validation_error", "Passo inválido.");
      // Sem resposta do banco o desfecho é incerto: se a reivindicação valeu, a
      // lease a segura até vencer, e depois o passo volta a ser reivindicável.
      return apiError(requestId, 503, "unavailable", "Não foi possível reivindicar agora. Tente de novo.", {}, {
        "Retry-After": "5",
      });
    }
    return apiOk(result.data);
  }
);
