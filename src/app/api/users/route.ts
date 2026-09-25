import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { mapUserRpcError } from "@/features/settings/lib/map-user-rpc-error";
import { createUserSchema } from "@/features/settings/schemas/user-actions";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Apenas administradores podem adicionar usuários." }, { status: 403 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(body.data);
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
  const { error } = await supabase.rpc("create_app_user", {
    p_email: parsed.data.email,
    p_name: parsed.data.name,
    p_password: parsed.data.password,
    p_role: parsed.data.role,
    p_avatar_color: parsed.data.avatar_color,
    p_must_change_password: parsed.data.must_change_password,
    p_apelido_atendimento: parsed.data.apelido_atendimento ?? null,
    p_assinar_mensagens: parsed.data.assinar_mensagens,
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

  revalidatePath("/app/equipe");
  return NextResponse.json({ ok: true, message: "Usuário adicionado." });
}
