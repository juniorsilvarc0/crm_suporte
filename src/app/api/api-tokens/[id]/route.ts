import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { API_TOKEN_LIST_COLUMNS, toApiTokenListItem } from "@/features/settings/lib/api-token-access";
import { updateApiTokenSchema } from "@/features/settings/schemas/api-token-actions";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Edita nome, escopos, tipo, limite e validade de um token NÃO revogado. O
// hash e o prefixo são imutáveis (trocar o segredo é gerar outro token), e o
// banco só dá UPDATE nas colunas editáveis.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Token inválido." }, { status: 400 });
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }
  const parsed = updateApiTokenSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        // Erro do objeto inteiro (ex.: "Nada para alterar.") não tem campo a destacar.
        message: parsed.error.flatten().formErrors[0] ?? "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .update(parsed.data)
    .eq("id", id)
    .is("revoked_at", null)
    .select(API_TOKEN_LIST_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível alterar o token." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, message: "Token não encontrado ou revogado." },
      { status: 404 }
    );
  }

  revalidatePath("/app/configuracoes");
  return NextResponse.json({ ok: true, item: toApiTokenListItem(data), message: "Token alterado." });
}

// Revoga um token (soft-delete via revoked_at). Mantém a linha para preservar o
// histórico de last_used_at e nunca reaproveitar o mesmo hash.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Token inválido." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível revogar o token." },
      { status: 500 }
    );
  }

  revalidatePath("/app/configuracoes");
  return NextResponse.json({ ok: true, message: "Token revogado." });
}
