import { NextResponse } from "next/server";

import { parseIntegrationLogFilters } from "@/features/integrations/lib/log-filters";
import { getIntegrationLogs } from "@/features/integrations/queries/get-integration-logs";
import type { IntegrationLogsResponse } from "@/features/integrations/types";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { searchParamsRecord } from "@/lib/http/search-params";
import { rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

// Cada pedido é uma consulta ao banco, e a rota é GET (fora da trava de origem
// do proxy): uma aba em laço, ou uma página de outra origem do mesmo site, a
// chamaria à vontade. A tela pede uma página por vez; o teto é por admin, e por
// processo.
const READS_PER_MINUTE = 60;

// Registros de integração (API v1 e repasse ao agente), para a aba da Conexão.
// Na query string: os filtros de `lib/log-filters.ts` (`integracao`, `status`,
// `acao`, `token`, `pedido`, `periodo`) e `cursor`, o `nextCursor` da página
// anterior. A resposta devolve os filtros que valeram: filtro que a lista não
// conhece é ignorado, e quem chama consegue ver que foi.
export async function GET(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const limit = rateLimit(`connection-logs:${auth.viewer.id}`, READS_PER_MINUTE, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: `Muitos pedidos seguidos. Tente de novo em ${limit.retryAfter} s.`,
      } satisfies IntegrationLogsResponse,
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const params = searchParamsRecord(new URL(request.url).searchParams);
  const filters = parseIntegrationLogFilters(params);
  const page = await getIntegrationLogs(filters, params.cursor?.trim() || null);

  if (page.state === "invalid_cursor") {
    return NextResponse.json({ ok: false, message: "Cursor inválido." } satisfies IntegrationLogsResponse, {
      status: 400,
    });
  }
  if (page.state === "unavailable") {
    return NextResponse.json(
      { ok: false, message: "Não foi possível ler os registros." } satisfies IntegrationLogsResponse,
      { status: 500 }
    );
  }
  return NextResponse.json({
    ok: true,
    filters,
    items: page.items,
    nextCursor: page.nextCursor,
  } satisfies IntegrationLogsResponse);
}
