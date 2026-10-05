import { NextResponse } from "next/server";

import { getIntegrationHealth } from "@/features/integrations/queries/get-integration-health";
import type { IntegrationHealthResponse } from "@/features/integrations/types";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";

export const runtime = "nodejs";

// Saúde das integrações, para a aba da Conexão: estado do WhatsApp, última
// mensagem recebida e as contagens das últimas 24 h do repasse e da API. Só lê.
// Responde 200 mesmo com uma parte indisponível: cada parte diz o próprio estado.
// A leitura é servida de novo por alguns segundos (`generatedAt` diz de quando
// ela é): pedir em laço não chama o provedor em laço.
export async function GET() {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  return NextResponse.json({
    ok: true,
    health: await getIntegrationHealth(),
  } satisfies IntegrationHealthResponse);
}
