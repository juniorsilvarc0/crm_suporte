import { NextResponse } from "next/server";

import { parseIntegrationLogFilters } from "@/features/integrations/lib/log-filters";
import { getIntegrationLogs } from "@/features/integrations/queries/get-integration-logs";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { searchParamsRecord } from "@/lib/http/search-params";

export const runtime = "nodejs";

// Registros de integração (API v1 e repasse ao agente), para a aba da Conexão.
// Na query string: os filtros de `lib/log-filters.ts` (`integracao`, `status`,
// `acao`, `token`, `pedido`, `periodo`) e `cursor`, o `nextCursor` da página
// anterior. A resposta devolve os filtros que valeram: filtro que a lista não
// conhece é ignorado, e quem chama consegue ver que foi.
export async function GET(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const params = searchParamsRecord(new URL(request.url).searchParams);
  const filters = parseIntegrationLogFilters(params);
  const page = await getIntegrationLogs(filters, params.cursor?.trim() || null);

  if (page.state === "invalid_cursor") {
    return NextResponse.json({ ok: false, message: "Cursor inválido." }, { status: 400 });
  }
  if (page.state === "unavailable") {
    return NextResponse.json(
      { ok: false, message: "Não foi possível ler os registros." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, filters, items: page.items, nextCursor: page.nextCursor });
}
