import { NextResponse } from "next/server";

import { getTicketTimeline } from "@/features/tickets/queries/get-ticket-timeline";
import { ticketTimelineQuerySchema } from "@/features/tickets/schemas/ticket";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[GET /api/tickets/[id]/timeline]";

/**
 * Uma página da timeline do ticket (o "Carregar anteriores" do detalhe), do
 * mais novo para o mais antigo. `before` é o `nextBefore` da página anterior,
 * CRU: o cliente monta a URL com URLSearchParams, porque um "+" do fuso solto
 * chega aqui como espaço e é recusado.
 *
 * A existência do ticket é conferida à parte: timeline vazia não diz nada (um
 * `before` anterior à abertura também dá página vazia), então só a leitura do
 * ticket separa o 404. Falha de leitura é 500, nunca página vazia.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, message: "Ticket inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const parsed = ticketTimelineQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
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
  // O schema confere o cursor com isTimelineInstant, a mesma regra da timeline
  // (fuso até ±15:59, como o Postgres; mais de 6 casas é recusado).
  const { before } = parsed.data;

  const supabase = createSupabaseAdminClient();
  const { data: ticket, error } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(ROUTE, error.code, error.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível carregar a timeline." },
      { status: 500 }
    );
  }
  if (!ticket) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Ticket não encontrado." },
      { status: 404 }
    );
  }

  try {
    const { items, hasMore, nextBefore } = await getTicketTimeline(id, { before });
    return NextResponse.json({ ok: true, items, hasMore, nextBefore });
  } catch (cause) {
    console.error(ROUTE, cause);
    return NextResponse.json(
      { ok: false, message: "Não foi possível carregar a timeline." },
      { status: 500 }
    );
  }
}
