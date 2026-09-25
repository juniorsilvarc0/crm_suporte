import {
  authorizeIntegration,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { getBotSignatureConfig } from "@/features/settings/lib/get-bot-signature";

export const runtime = "nodejs";

// GET /api/integracao/bot-signature — o agente lê a config de assinatura do bot
// (fonte de verdade / reconciliação). Autenticado pelo TOKEN DE API (o mesmo dos
// webhooks: header `x-webhook-secret` ou `Authorization: Bearer`).
// Resposta: { ok: true, enabled: boolean, apelido: string }.
export async function GET(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;

  const config = await getBotSignatureConfig();
  return ok(config);
}
