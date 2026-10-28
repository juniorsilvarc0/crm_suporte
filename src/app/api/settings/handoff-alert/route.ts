import { NextResponse } from "next/server";

import { handoffAlertFrom } from "@/features/settings/lib/get-handoff-alert";
import { handoffAlertSchema } from "@/features/settings/schemas/handoff-alert";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Aviso à equipe no handoff da IA: o telefone e/ou o grupo do WhatsApp que
// recebem o aviso. Guardado em app_settings.key = 'handoff_alert'. Rota da
// sessão do dashboard (admin). Quem envia é o handoff da API v1
// (features/chat/lib/handoff-alert.ts).
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

  const parsed = handoffAlertSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Valor inválido." },
      { status: 400 }
    );
  }

  const { number, group_jid, group_name } = parsed.data;
  const value = {
    number: number || null,
    group_jid: group_jid || null,
    group_name: group_jid && group_name ? group_name : null,
  };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("app_settings").upsert(
    { key: "handoff_alert", value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) {
    console.error("[settings/handoff-alert] save failed", error.code, error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível salvar." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...handoffAlertFrom(value) });
}
