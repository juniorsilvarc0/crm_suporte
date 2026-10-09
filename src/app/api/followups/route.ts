import { NextResponse } from "next/server";

import { followupCreateSchema } from "@/features/followups/schemas/followup";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Cria um retorno (follow-up) ligado a um ticket. Nasce `pendente` (default do
 * banco), sem `done_at`. O `created_by_user_id` vem do viewer, não do corpo.
 */
export async function POST(request: Request) {
  const auth = await requireDashboardUser();
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

  const parsed = followupCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos destacados.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("followups")
    .insert({ ...parsed.data, created_by_user_id: auth.viewer.id })
    .select("id")
    .single();

  if (error) {
    // ticket_id inexistente (FK) é dado ruim do cliente → 422.
    const status = error.code === "23503" ? 422 : 500;
    console.error("[POST /api/followups]", error.code, error.message);
    return NextResponse.json(
      {
        ok: false,
        message: status === 422 ? "O ticket do retorno não existe." : "Não foi possível criar o retorno.",
      },
      { status }
    );
  }

  return NextResponse.json({ ok: true, followup: { id: data.id } });
}
