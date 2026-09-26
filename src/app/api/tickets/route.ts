import { NextResponse } from "next/server";

import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { getConversationTickets } from "@/features/tickets/queries/get-conversation-tickets";
import { ticketCreateSchema } from "@/features/tickets/schemas/ticket";
import { createTicket } from "@/features/tickets/server/ticket-service";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

/**
 * Tickets NÃO terminais da conversa e o ticket em foco (painel do chat). Erro de
 * banco responde 500, nunca lista vazia: vazio seria lido como "nenhum ticket
 * aberto", e a tela ofereceria abrir outro.
 */
export async function GET(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const conversationId = new URL(request.url).searchParams.get("conversation_id");
  if (!isUuid(conversationId)) {
    return NextResponse.json({ ok: false, message: "Conversa inválida." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  try {
    const { active_ticket_id, tickets } = await getConversationTickets(
      createSupabaseAdminClient(),
      conversationId
    );
    return NextResponse.json({ ok: true, active_ticket_id, tickets });
  } catch (error) {
    console.error("[GET /api/tickets]", error);
    return NextResponse.json(
      { ok: false, message: "Não foi possível carregar os tickets da conversa." },
      { status: 500 }
    );
  }
}

/**
 * Abre o ticket na conversa ("Novo ticket" do chat). Só pelo serviço (RPC
 * create_ticket): o ator é o analista da sessão, nunca o corpo (.strict()
 * recusa). A mesma idempotency_key de novo devolve o ticket já aberto com 200 e
 * `created: false`, em vez de abrir outro. Com `take_over`, o aviso à IA sai do
 * próprio serviço, e o telefone da conversa nunca chega à resposta.
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

  const parsed = ticketCreateSchema.safeParse(body.data);
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

  const result = await createTicket(
    createSupabaseAdminClient(),
    { kind: "user", userId: auth.viewer.id },
    parsed.data
  );
  if (!result.ok) return ticketErrorResponse("[POST /api/tickets]", result.error);

  const { ticket, created, linked_messages } = result.data;
  return NextResponse.json(
    { ok: true, ticket, created, linked_messages },
    { status: created ? 201 : 200 }
  );
}
