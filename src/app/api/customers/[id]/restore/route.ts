import { NextResponse } from "next/server";

import { cadastroErrorResponse } from "@/features/customers/lib/cadastro-error-response";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reativar é de admin, como arquivar. O CNPJ é único só entre ATIVAS: se outra
 * empresa ativa ficou com ele enquanto esta estava arquivada, o índice
 * (customers_cnpj_active_uidx) recusa e a rota responde 409 no campo cnpj.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Empresa inválida." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ archived_at: null })
    .eq("id", id)
    .not("archived_at", "is", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return cadastroErrorResponse("[POST /api/customers/[id]/restore]", error);
  }

  if (!data) {
    // Nenhuma linha arquivada com este id: ou não existe, ou já está ativa.
    const { data: current, error: readError } = await supabase
      .from("customers")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      console.error("[POST /api/customers/[id]/restore]", readError.message);
      return NextResponse.json(
        { ok: false, message: "Não foi possível reativar a empresa." },
        { status: 500 }
      );
    }
    if (!current) {
      return NextResponse.json({ ok: false, message: "Empresa não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, message: "Empresa já estava ativa." });
  }

  return NextResponse.json({ ok: true, message: "Empresa reativada." });
}
