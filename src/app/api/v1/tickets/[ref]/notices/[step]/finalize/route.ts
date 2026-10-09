import { finalizeTicketNotice } from "@/features/tickets/server/ticket-notices";
import { apiError } from "@/lib/api/v1/errors";
import { noticeFinalizeBodySchema, noticeTarget } from "@/lib/api/v1/notices";
import { apiOk, invalidInput, notFound } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fecha a reivindicação com o desfecho: `sent` (o aviso saiu; o passo não se
 * reivindica mais) ou `failed` (não saiu; o passo volta a ser reivindicável na
 * hora). Exige o `claim_token` da reivindicação atual. Repetir o mesmo
 * desfecho é seguro.
 */
export const POST = withApi<{ ref: string; step: string }>(
  { route: "/api/v1/tickets/[ref]/notices/[step]/finalize", scopes: ["notices:claim"] },
  async ({ request, params, requestId, supabase }) => {
    const target = await noticeTarget(supabase, requestId, params);
    if (!target.ok) return target.response;

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = noticeFinalizeBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    const result = await finalizeTicketNotice(supabase, {
      ticketId: target.ticketId,
      step: target.step,
      claimToken: parsed.data.claim_token,
      outcome: parsed.data.outcome,
      error: parsed.data.error,
    });
    if (result.ok) return apiOk(result.data);

    switch (result.error) {
      case "notice_not_found":
        return notFound(requestId, "Este aviso nunca foi reivindicado.");
      case "claim_lost":
        return apiError(
          requestId,
          409,
          "notice_claim_lost",
          "Outra reivindicação assumiu este aviso (a sua lease venceu). Não reenvie a mensagem.",
          { current: result.status }
        );
      case "already_finalized":
        return apiError(requestId, 409, "notice_already_finalized", "Este aviso já foi fechado com outro desfecho.", {
          current: result.status,
        });
      case "invalid":
        return apiError(requestId, 400, "validation_error", "Desfecho inválido.");
      default:
        return apiError(requestId, 503, "unavailable", "Não foi possível fechar o aviso agora. Repetir é seguro.", {}, {
          "Retry-After": "5",
        });
    }
  }
);
