import { NextResponse } from "next/server";

import { getTicketCatalog } from "@/features/tickets/queries/get-ticket-catalog";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * O catálogo dos tickets para o cliente (chat, quadro): status, a matriz de
 * transições, as prioridades com o SLA, as filas e as categorias ativas.
 *
 * Cada parte é `null` quando a leitura dela falhou (getTicketCatalog já loga), e
 * a tela trata a parte sozinha: um status que falhou não derruba as filas do
 * "Novo ticket". Só é 500 quando nenhuma parte veio, porque aí não há o que
 * mostrar e a tela oferece "Tentar de novo".
 */
export async function GET() {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { statuses, transitions, priorities, products, categories } = await getTicketCatalog();
  if (!statuses && !transitions && !priorities && !products && !categories) {
    console.error("[GET /api/tickets/catalog] nenhuma parte do catálogo foi lida");
    return NextResponse.json(
      { ok: false, message: "Não foi possível carregar o catálogo dos tickets." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, statuses, transitions, priorities, products, categories });
}
