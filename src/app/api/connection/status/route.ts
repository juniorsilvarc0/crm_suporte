import { NextResponse } from "next/server";

import { getConnectionStatus } from "@/features/connection/queries/get-connection-events";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O estado da conexão do WhatsApp segundo o monitor (worker), para o aviso do
 * topo — que todo usuário vê, então a rota é de sessão, não de admin. Lê só o
 * banco: nunca chama o provedor, pode ser pedida por toda aba aberta. Não leva
 * nada da integração além do estado (sem id, telefone, URL ou token).
 */
export async function GET() {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase admin não está configurado." }, { status: 500 });
  }

  const status = await getConnectionStatus(createSupabaseAdminClient());
  if (!status) {
    return NextResponse.json({ ok: false, message: "Não foi possível ler o estado da conexão." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status });
}
