import { NextResponse } from "next/server";

import { mapUserRpcError } from "@/features/settings/lib/map-user-rpc-error";
import { definirSenhaSchema } from "@/features/settings/schemas/user-actions";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// O próprio usuário define a nova senha no primeiro acesso. Como é uma ação
// sobre a própria conta, exige apenas sessão válida (não papel de admin). A RPC
// reset_app_user_password, chamada com actor = alvo, troca a senha E limpa o
// flag must_change_password.
export async function POST(request: Request) {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Autenticação não está configurada neste ambiente." },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = definirSenhaSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc("reset_app_user_password", {
    p_actor_id: viewer.id,
    p_id: viewer.id,
    p_password: parsed.data.password,
  });

  if (error) {
    const mapped = mapUserRpcError(error.message);
    return NextResponse.json(
      {
        ok: false,
        message: mapped.message,
        errors: mapped.field ? { [mapped.field]: [mapped.message] } : undefined,
      },
      { status: mapped.status }
    );
  }

  return NextResponse.json({ ok: true, message: "Senha definida." });
}
