import { NextResponse } from "next/server";

import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { connectUazapi } from "@/features/chat/lib/connection/uazapi";

// Proxy server-side p/ obter o QR da uazapi (evita mixed-content no browser e
// mantém o token fora do cliente). IMPORTANTE: cada GET chama /instance/connect,
// que (re)inicia o socket de pareamento — NÃO chamar em loop curto. O painel
// busca no mount, a cada ~25s (validade do QR) ou no "Atualizar". O estado leve
// é consultado à parte em /api/connection/state.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QrPayload = {
  ok: boolean;
  configured: boolean;
  qrcode: string | null;
  pairingCode: string | null;
  connected: boolean;
  message?: string;
};

export async function GET() {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const supabase = createSupabaseAdminClient();
  const integration = await getUazapiIntegration(supabase);

  if (!integration) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        qrcode: null,
        pairingCode: null,
        connected: false,
        message: "Instância uazapi não configurada.",
      } satisfies QrPayload,
      { status: 200 }
    );
  }

  try {
    const conn = await connectUazapi(integration.apiUrl, integration.token);
    return NextResponse.json(
      {
        ok: true,
        configured: true,
        qrcode: conn.qrcode,
        pairingCode: conn.pairingCode,
        connected: conn.connected,
      } satisfies QrPayload,
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        qrcode: null,
        pairingCode: null,
        connected: false,
        message: error instanceof Error ? error.message : "Falha ao consultar a uazapi.",
      } satisfies QrPayload,
      { status: 200 }
    );
  }
}
