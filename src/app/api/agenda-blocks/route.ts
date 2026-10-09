import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getAgendaBlocks } from "@/features/appointments/queries/get-agenda-blocks";
import { agendaBlockCreateSchema } from "@/features/appointments/schemas/agenda-block";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function isoParam(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Os bloqueios que tocam `?from=` (obrigatório) até `?to=` (opcional; sem ele,
 * todos daqui em diante). Serve ao cadastro de bloqueios e ao aviso do diálogo
 * de agendamento, que também abre fora da Agenda (na ficha do ticket).
 */
export async function GET(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const from = isoParam(url.searchParams.get("from"));
  const to = url.searchParams.has("to") ? isoParam(url.searchParams.get("to")) : undefined;
  if (!from || to === null) {
    return NextResponse.json({ ok: false, message: "Período inválido." }, { status: 400 });
  }

  const blocks = await getAgendaBlocks({ startIso: from, endIso: to });
  if (!blocks) {
    return NextResponse.json({ ok: false, message: "Não foi possível carregar os bloqueios." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, blocks });
}

/**
 * Cadastro de um bloqueio (member ou admin): de um técnico ou de todos. O
 * `created_by_user_id` é o usuário da sessão. Bloqueio AVISA, não impede
 * (UI.md §5.17): nada aqui recusa compromisso.
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

  const parsed = agendaBlockCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos destacados.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agenda_blocks")
    .insert({ ...parsed.data, created_by_user_id: auth.viewer.id })
    .select("id")
    .single();

  if (error) {
    // Técnico inexistente é dado ruim do cliente → 422.
    const status = error.code === "23503" ? 422 : 500;
    console.error("[POST /api/agenda-blocks]", error.code, error.message);
    return NextResponse.json(
      {
        ok: false,
        message: status === 422 ? "O técnico escolhido não existe." : "Não foi possível salvar o bloqueio.",
      },
      { status }
    );
  }

  revalidatePath("/app/agendamentos");
  return NextResponse.json({ ok: true, block: { id: data.id } });
}
