import { NextResponse } from "next/server";
import type { ZodError } from "zod";

import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { ticketPatchSchema } from "@/features/tickets/schemas/ticket";
import { updateTicket } from "@/features/tickets/server/ticket-service";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

/**
 * Edição do ticket: a versão que a tela leu e SÓ os campos alterados (o
 * formulário manda os dirtyFields). Ausente não mexa; null tira a fila, a
 * categoria ou a empresa. Status, responsável e foco têm rota própria, e o
 * .strict() recusa essas chaves aqui. Versão velha → 409 `version_conflict`
 * com `current_version`; o mesmo valor de novo é no-op (`changed: false`).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = ticketPatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: rootErrorMessage(parsed.error) ?? "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { version, ...patch } = parsed.data;
  const result = await updateTicket(
    createSupabaseAdminClient(),
    { kind: "user", userId: auth.viewer.id },
    id,
    version,
    patch
  );
  if (!result.ok) return ticketErrorResponse("[PATCH /api/tickets/[id]]", result.error);

  const { ticket, changed } = result.data;
  return NextResponse.json({ ok: true, ticket, changed });
}

/**
 * Erro de raiz não entra em `fieldErrors`: sem isto a tela receberia "Revise os
 * campos destacados." sem nenhum campo destacado. Cobre o corpo só com a versão
 * (refine do schema) e a chave recusada pelo `.strict()` (ex.: status, que tem
 * rota própria). Duplicado de api/customers/[id] (2º uso).
 */
function rootErrorMessage(error: ZodError): string | null {
  const root = error.issues.find((issue) => issue.path.length === 0);
  if (root?.code === "custom") return root.message;
  if (root?.code === "unrecognized_keys") {
    return `Campo que não pode ser alterado por aqui: ${root.keys.join(", ")}.`;
  }
  return null;
}
