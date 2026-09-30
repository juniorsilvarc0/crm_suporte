import { buildTriageContext } from "@/features/integrations/server/triage-context";
import { contextQuerySchema } from "@/lib/api/v1/context";
import { searchParamsOf } from "@/lib/api/v1/cursor";
import { apiOk, invalidInput, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tudo o que a IA precisa para triar, pelo telefone (D11): contato, empresa,
 * contrato e alerta, conversa, tickets abertos com as transições, últimos
 * tickets, últimas mensagens e `ai_may_reply`. Telefone desconhecido é 200 com
 * `contact: null`; o GET nunca cria nada. Leitura que falha é 503 inteiro.
 */
export const GET = withApi({ route: "/api/v1/context", scopes: ["context:read"] }, async ({ request, requestId, supabase }) => {
  const parsed = contextQuerySchema.safeParse(searchParamsOf(request));
  if (!parsed.success) return invalidInput(requestId, parsed.error);

  try {
    return apiOk(await buildTriageContext(supabase, parsed.data.phone));
  } catch (error) {
    console.error(`[api/v1] ${requestId} context`, error);
    return unavailable(requestId, "o contexto");
  }
});
