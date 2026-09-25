import { NextResponse } from "next/server";
import { z } from "zod";

import { getRelayConfig } from "@/features/settings/lib/get-relay-url";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// URL para onde o CRM repassa as mensagens do bot. Guardado em
// app_settings.key = 'automation' → value.relay_url. String vazia limpa e volta
// ao fallback do env (N8N_WEBHOOK_URL). Rota protegida pela sessão do dashboard
// (middleware) — não é pública.
const schema = z.object({
  relayUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(
      (v) => v === "" || /^https?:\/\/.+/i.test(v),
      "Informe uma URL http(s) válida (ou deixe vazio para usar o fallback)."
    ),
});

export async function GET() {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const config = await getRelayConfig();
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

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Valor inválido." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "automation",
      value: { relay_url: parsed.data.relayUrl },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const config = await getRelayConfig();
  return NextResponse.json({ ok: true, ...config });
}
