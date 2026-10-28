import { NextResponse } from "next/server";

import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import {
  getUazapiStatus,
  listUazapiGroups,
  type UazapiGroup,
} from "@/features/chat/lib/connection/uazapi";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupsPayload = {
  ok: boolean;
  connected: boolean;
  groups: UazapiGroup[];
  message?: string;
};

// Os grupos do WhatsApp do CRM, para escolher o que recebe o aviso de handoff.
// `?force=1` relê do WhatsApp (o "Atualizar"); sem ele, o cache da uazapi.
// Desconectado não é erro: lista vazia com o motivo.
export async function GET(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const supabase = createSupabaseAdminClient();
  const integration = await getUazapiIntegration(supabase);
  if (!integration) {
    return NextResponse.json({
      ok: true,
      connected: false,
      groups: [],
      message: "O WhatsApp do CRM não está configurado.",
    } satisfies GroupsPayload);
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const status = await getUazapiStatus(integration.apiUrl, integration.token);
    if (!status.connected) {
      return NextResponse.json({
        ok: true,
        connected: false,
        groups: [],
        message: "O WhatsApp está desconectado: conecte para listar os grupos.",
      } satisfies GroupsPayload);
    }
    const groups = await listUazapiGroups(integration.apiUrl, integration.token, force);
    return NextResponse.json({ ok: true, connected: true, groups } satisfies GroupsPayload);
  } catch (error) {
    console.error("[connection/groups] failed", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        groups: [],
        message: "Não foi possível listar os grupos agora.",
      } satisfies GroupsPayload,
      { status: 502 }
    );
  }
}
