import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isAmbiguousLeadStatusError,
  setLeadStatusFromSingleDeal,
} from "@/features/leads/queries/set-lead-status";
import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  status: z.string().trim().min(1),
});

// Atualiza o status de um lead (usado pelo arrastar do Kanban do funil).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Lead inválido." }, { status: 400 });
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

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Status inválido." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  try {
    await setLeadStatusFromSingleDeal(supabase, {
      leadId: id,
      status: parsed.data.status,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null;
    if (code === "P0002") {
      return NextResponse.json({ ok: false, message: "Lead não encontrado." }, { status: 404 });
    }
    return NextResponse.json(
      {
        ok: false,
        message: isAmbiguousLeadStatusError(error)
          ? "Esta pessoa possui mais de uma oportunidade ativa. Mova o card correto no Funil."
          : code === "22023"
            ? "Categoria inexistente."
            : "Não foi possível sincronizar a etapa da pessoa com o Funil.",
      },
      { status: isAmbiguousLeadStatusError(error) ? 409 : code === "22023" ? 400 : 500 }
    );
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/leads");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, message: "Status atualizado." });
}
