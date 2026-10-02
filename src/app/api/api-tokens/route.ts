import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { API_TOKEN_LIST_COLUMNS, toApiTokenListItem } from "@/features/settings/lib/api-token-access";
import { createApiTokenSchema } from "@/features/settings/schemas/api-token-actions";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { generateApiToken } from "@/lib/security/api-token";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select(API_TOKEN_LIST_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível listar os tokens." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, tokens: (data ?? []).map(toApiTokenListItem) });
}

export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

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

  const parsed = createApiTokenSchema.safeParse(body.data);
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

  const generated = generateApiToken();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .insert({
      name: parsed.data.name,
      token_hash: generated.hash,
      token_prefix: generated.prefix,
      scopes: parsed.data.scopes,
      actor_type: parsed.data.actor_type,
      rate_limit_per_min: parsed.data.rate_limit_per_min,
      expires_at: parsed.data.expires_at,
      created_by: auth.viewer.id,
    })
    .select(API_TOKEN_LIST_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível gerar o token." },
      { status: 500 }
    );
  }

  revalidatePath("/app/conexao");

  // O token em texto puro é devolvido UMA única vez — a UI o exibe para cópia
  // e nunca mais tem como recuperá-lo (só o hash fica no banco).
  return NextResponse.json({
    ok: true,
    token: generated.token,
    item: toApiTokenListItem(data),
    message: "Token gerado.",
  });
}
