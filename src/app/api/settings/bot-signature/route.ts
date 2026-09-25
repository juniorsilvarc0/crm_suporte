import { NextResponse } from "next/server";

import { getBotSignatureConfig } from "@/features/settings/lib/get-bot-signature";
import { pushBotSignatureToAgent } from "@/features/settings/lib/push-bot-signature";
import { botSignatureSchema } from "@/features/settings/schemas/bot-signature";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Config da assinatura das mensagens da IA. Guardado em app_settings.key =
// 'bot_signature'. Rota protegida pela sessão do dashboard (admin) — não é
// pública. O agente recebe a config por push a cada save (a leitura por GET
// volta na API v1, Fase 5).
export async function GET() {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const config = await getBotSignatureConfig();
  return NextResponse.json({ ok: true, ...config });
}

export async function PATCH(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase não configurado." },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = botSignatureSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Valor inválido." },
      { status: 400 }
    );
  }

  const config = { enabled: parsed.data.enabled, apelido: parsed.data.apelido };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "bot_signature",
      value: config,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  // Push best-effort ao agente. A falha NÃO desfaz o save — a UI mostra o aviso
  // para salvar de novo.
  const agent = await pushBotSignatureToAgent(config);

  return NextResponse.json({ ok: true, ...config, agent });
}
