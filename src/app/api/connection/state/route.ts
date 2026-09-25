import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { getUazapiStatus } from "@/features/chat/lib/connection/uazapi";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";

// Estado da conexão (leve). Pode ser consultado com frequência SEM disparar
// /instance/connect. Ao detectar "conectado", grava o telefone dono (owner) em
// chat_integrations.phone_number — uma vez.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectionState = "open" | "connecting" | "close" | "unknown";

type StatePayload = {
  ok: boolean;
  configured: boolean;
  state: ConnectionState;
  instance: string | null;
  connected: boolean;
  // URL do servidor uazapi (NÃO é segredo — o token nunca é exposto). Serve para
  // pré-preencher o formulário ao "Trocar credenciais".
  apiUrl?: string | null;
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
        ok: true,
        configured: false,
        state: "unknown",
        instance: null,
        connected: false,
        message: "Instância uazapi não configurada.",
      } satisfies StatePayload,
      { status: 200 }
    );
  }

  try {
    const status = await getUazapiStatus(integration.apiUrl, integration.token);

    // Persiste o telefone dono ao conectar (uma vez).
    if (status.connected && status.owner && status.owner !== integration.phone_number) {
      await supabase
        .from("chat_integrations")
        .update({ phone_number: status.owner, updated_at: new Date().toISOString() })
        .eq("id", integration.id);
    }

    return NextResponse.json(
      {
        ok: true,
        configured: true,
        state: status.state,
        instance: status.owner ?? integration.phone_number,
        connected: status.connected,
        apiUrl: integration.apiUrl,
      } satisfies StatePayload,
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        state: "unknown",
        instance: integration.phone_number,
        connected: false,
        apiUrl: integration.apiUrl,
        message: error instanceof Error ? error.message : "Falha ao consultar a uazapi.",
      } satisfies StatePayload,
      { status: 200 }
    );
  }
}
