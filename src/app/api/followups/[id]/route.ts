import { NextResponse } from "next/server";
import { z } from "zod";

import { followupUpdateSchema } from "@/features/followups/schemas/followup";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const idSchema = z.uuid();

type Params = { params: Promise<{ id: string }> };

/**
 * Edição parcial do retorno (inclui concluir/cancelar). O `done_at` é derivado
 * do status AQUI (não vem do corpo): concluído → agora; pendente/cancelado →
 * null — o que honra o invariante do banco.
 */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const idResult = idSchema.safeParse((await params).id);
  if (!idResult.success) {
    return NextResponse.json({ ok: false, message: "Retorno inválido." }, { status: 400 });
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = followupUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos destacados.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // done_at derivado do status (não vem do corpo), para honrar o invariante.
  const doneAt =
    parsed.data.status === "concluido"
      ? new Date().toISOString()
      : parsed.data.status === "pendente" || parsed.data.status === "cancelado"
        ? null
        : undefined;
  const update: Database["public"]["Tables"]["followups"]["Update"] = {
    ...parsed.data,
    ...(doneAt !== undefined ? { done_at: doneAt } : {}),
  };

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("followups")
    .update(update)
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[PATCH /api/followups/[id]]", error.code, error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível salvar o retorno." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Retorno não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, followup: { id: data.id } });
}

/** Exclui o retorno. */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const idResult = idSchema.safeParse((await params).id);
  if (!idResult.success) {
    return NextResponse.json({ ok: false, message: "Retorno inválido." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("followups")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[DELETE /api/followups/[id]]", error.code, error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível excluir o retorno." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Retorno não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
