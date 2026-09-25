import { NextResponse } from "next/server";

import { mapUserRpcError } from "@/features/settings/lib/map-user-rpc-error";
import { resetPasswordSchema } from "@/features/settings/schemas/user-actions";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
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

  const parsed = resetPasswordSchema.safeParse(body.data);
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
    p_id: id,
    p_password: parsed.data.password,
    p_must_change_password: parsed.data.must_change_password ?? null,
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

  return NextResponse.json({ ok: true, message: "Senha redefinida." });
}
