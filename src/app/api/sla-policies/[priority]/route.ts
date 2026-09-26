import { NextResponse } from "next/server";

import { catalogErrorBody, mapCatalogError } from "@/features/tickets/lib/map-ticket-error";
import { isTicketPriority } from "@/features/tickets/lib/ticket-priority";
import { catalogRootErrorMessage, slaPolicyPatchSchema } from "@/features/tickets/schemas/catalog";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ROUTE = "[PATCH /api/sla-policies/[priority]]";

// As colunas de TicketSlaPolicy; nunca select("*").
const SLA_SELECT = "priority, rank, first_response_minutes, resolution_minutes, warn_pct";

/**
 * Minutos de 1ª resposta e de solução e o aviso (%) de uma prioridade (4f,
 * admin). Vale para os tickets abertos daqui em diante: cada ticket guarda o
 * snapshot do SLA na abertura, e os abertos não mudam. A prioridade é da
 * allowlist (a chave e o `rank` são da migration). 1ª resposta maior que a
 * solução → 400 no campo, do zod ou do banco (sla_policies_order_check, quando
 * só um dos dois vem e o outro é o gravado).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ priority: string }> }
) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { priority } = await params;
  if (!isTicketPriority(priority)) {
    return NextResponse.json({ ok: false, message: "Prioridade inválida." }, { status: 400 });
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

  const parsed = slaPolicyPatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: catalogRootErrorMessage(parsed.error) ?? "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("sla_policies")
    .update(parsed.data)
    .eq("priority", priority)
    .select(SLA_SELECT)
    .maybeSingle();

  if (error) {
    const mapped = mapCatalogError(error, "sla_policy");
    if (mapped.status >= 500) console.error(ROUTE, error.code, error.message);
    return NextResponse.json(catalogErrorBody(mapped), { status: mapped.status });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Prioridade não encontrada." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, item: data });
}
