import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { catalogErrorBody, mapCatalogError } from "@/features/tickets/lib/map-ticket-error";
import { isTicketStatus } from "@/features/tickets/lib/ticket-status";
import {
  catalogRootErrorMessage,
  ticketStatusPatchSchema,
} from "@/features/tickets/schemas/catalog";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const ROUTE = "[PATCH /api/ticket-statuses/[key]]";

// As colunas de TicketStatusOption; nunca select("*").
const STATUS_SELECT = "key, label, color, position, sla_mode, is_terminal";

type Db = SupabaseClient<Database>;
// A linha como o banco a entrega (chave e modo como texto); a tela a lê como
// TicketStatusOption, pelo mesmo select do catálogo.
type StatusRow = Pick<
  Database["public"]["Tables"]["ticket_statuses"]["Row"],
  "key" | "label" | "color" | "position" | "sla_mode" | "is_terminal"
>;

/**
 * Rótulo e cor de um status (4f, admin); aparecem em todos os selos pelo
 * catálogo. As 8 chaves são fixas (allowlist), e modo do SLA, terminal e
 * posição são da migration: o .strict() responde 400 a eles. Rótulo repetido
 * (sem caixa) → 409 `duplicate` com o status que já o usa.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { key } = await params;
  if (!isTicketStatus(key)) {
    return NextResponse.json({ ok: false, message: "Status inválido." }, { status: 400 });
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

  const parsed = ticketStatusPatchSchema.safeParse(body.data);
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

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("ticket_statuses")
    .update(parsed.data)
    .eq("key", key)
    .select(STATUS_SELECT)
    .maybeSingle();

  if (error) {
    // 23505 aqui só pode ser ticket_statuses_label_uidx (a chave não muda), e
    // só com o rótulo no corpo.
    const label = parsed.data.label;
    const item =
      error.code === "23505" && label !== undefined
        ? await findStatusByLabel(supabase, key, label)
        : undefined;
    const mapped = mapCatalogError(error, "ticket_status");
    if (mapped.status >= 500) console.error(ROUTE, error.code, error.message);
    return NextResponse.json(catalogErrorBody(mapped, item), { status: mapped.status });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Status não encontrado." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, item: data });
}

/**
 * O OUTRO status com o rótulo. São 8 linhas fixas: lê todas e compara como
 * ticket_statuses_label_uidx (sem caixa e sem espaço nas pontas), sem ilike.
 * Falhar ao reler só tira o item do 409.
 */
async function findStatusByLabel(
  supabase: Db,
  key: string,
  label: string
): Promise<StatusRow | undefined> {
  const { data, error } = await supabase
    .from("ticket_statuses")
    .select(STATUS_SELECT)
    .neq("key", key);
  if (error) console.error(ROUTE, "status existente", error.message);
  return data?.find((row) => row.label.trim().toLowerCase() === label.toLowerCase());
}
