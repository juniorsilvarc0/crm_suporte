import { NextResponse } from "next/server";

import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { HANDOFF_ALERT_TEST_TEXT, sendHandoffAlert } from "@/features/chat/lib/handoff-alert";
import { readHandoffAlertConfig } from "@/features/settings/lib/get-handoff-alert";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

// "Enviar teste" da configuração salva: o mesmo envio do handoff, com um texto
// de teste, para cada canal preenchido.
export async function POST() {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase não configurado." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  try {
    const config = await readHandoffAlertConfig(supabase);
    if (!config.number && !config.groupJid) {
      return NextResponse.json(
        { ok: false, message: "Salve um telefone ou um grupo antes de testar." },
        { status: 400 }
      );
    }
    const integration = await getUazapiIntegration(supabase);
    if (!integration) {
      return NextResponse.json(
        { ok: false, message: "O WhatsApp do CRM não está configurado." },
        { status: 409 }
      );
    }
    const result = await sendHandoffAlert(integration, config, HANDOFF_ALERT_TEST_TEXT);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[settings/handoff-alert/test] failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, message: "Não foi possível enviar o teste." }, { status: 500 });
  }
}
