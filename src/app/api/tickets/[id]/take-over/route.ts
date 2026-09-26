import { NextResponse } from "next/server";

import {
  ticketErrorBody,
  ticketErrorResponse,
} from "@/features/tickets/lib/ticket-error-response";
import { ticketTakeOverSchema } from "@/features/tickets/schemas/ticket";
import { takeOverTicket } from "@/features/tickets/server/ticket-service";
import type { TicketTakeOverErrorBody } from "@/features/tickets/types";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[POST /api/tickets/[id]/take-over]";

/**
 * "Assumir" pelo ticket (Atender no Início, Assumir no chat com foco): conversa
 * `human`, ticket em foco, responsável = quem está logado e novo|em_triagem →
 * em_atendimento, numa transação só. O aviso à IA sai do serviço. Tomar o
 * ticket de outro analista exige `reassign: true`; sem ele, 409
 * `already_assigned` com o id e o nome de quem está com o ticket, para a tela
 * perguntar antes. O corpo é JSON mesmo sem campo (`{}`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = ticketTakeOverSchema.safeParse(body.data);
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
  const result = await takeOverTicket(supabase, auth.viewer.id, id, parsed.data.reassign);

  if (!result.ok) {
    const { error } = result;

    // O nome é conforto da tela: se a leitura falhar, o 409 sai só com o id.
    // Colunas explícitas (app_users tem grant por coluna, sem password_hash).
    if (error.code === "already_assigned" && error.assignedToUserId) {
      const { data: assignee, error: lookupError } = await supabase
        .from("app_users")
        .select("id, name")
        .eq("id", error.assignedToUserId)
        .maybeSingle();
      if (lookupError) {
        console.error(ROUTE, "nome do responsável", lookupError.message);
      }

      const responseBody: TicketTakeOverErrorBody = {
        ...ticketErrorBody(error),
        assigned_to_name: assignee?.name,
      };
      return NextResponse.json(responseBody, { status: error.status });
    }

    return ticketErrorResponse(ROUTE, error);
  }

  const { ticket, conversation } = result.data;
  return NextResponse.json({ ok: true, ticket, conversation });
}
