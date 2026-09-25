import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { mapUserRpcError } from "@/features/settings/lib/map-user-rpc-error";
import { updateUserSchema } from "@/features/settings/schemas/user-actions";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Usuário inválido." }, { status: 400 });
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = updateUserSchema.safeParse(body.data);
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
  const { error } = await supabase.rpc("update_app_user", {
    p_actor_id: viewer.id,
    p_id: id,
    p_name: parsed.data.name,
    p_email: parsed.data.email,
    p_is_active: parsed.data.is_active,
    p_role: parsed.data.role,
    p_avatar_url: parsed.data.avatar_url ?? null,
    p_avatar_color: parsed.data.avatar_color,
    p_apelido_atendimento: parsed.data.apelido_atendimento ?? null,
    p_assinar_mensagens: parsed.data.assinar_mensagens ?? null,
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
  revalidatePath("/app/perfil");
  return NextResponse.json({ ok: true, message: "Usuário atualizado." });
}

// Exclusão definitiva (hard delete). A autorização mora na RPC delete_app_user
// (só admin; nunca a si mesmo; nunca o último admin ativo).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Usuário inválido." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc("delete_app_user", {
    p_actor_id: viewer.id,
    p_id: id,
  });

  if (error) {
    const mapped = mapUserRpcError(error.message);
    return NextResponse.json({ ok: false, message: mapped.message }, { status: mapped.status });
  }

  revalidatePath("/app/equipe");
  return NextResponse.json({ ok: true, message: "Usuário excluído." });
}
