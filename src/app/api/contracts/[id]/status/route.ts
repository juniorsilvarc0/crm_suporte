import { NextResponse } from "next/server";
import { z } from "zod";

import { CONTRACT_STATUSES, type ContractStatus } from "@/features/contracts/lib/contract-status";
import { contractStatusSchema } from "@/features/contracts/schemas/contract";
import { cadastroErrorResponse } from "@/features/customers/lib/cadastro-error-response";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// O jsonb que set_support_contract_status devolve. Conferido em vez de
// confiado: a rota não repassa ao cliente o que não reconhece.
const statusResultSchema = z.object({
  status: z.enum(CONTRACT_STATUSES),
  ends_on: z.string().nullable(),
  changed: z.boolean(),
});

const STATUS_MESSAGE: Record<ContractStatus, string> = {
  ativo: "Contrato reativado.",
  suspenso: "Contrato suspenso.",
  encerrado: "Contrato encerrado.",
};

// Porta única da situação do contrato: ativo ↔ suspenso; ativo|suspenso →
// encerrado (terminal). O mesmo status de novo é no-op (changed=false).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Contrato inválido." }, { status: 400 });
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

  const parsed = contractStatusSchema.safeParse(body.data);
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
  const { data, error } = await supabase.rpc("set_support_contract_status", {
    p_actor_id: auth.viewer.id,
    p_contract_id: id,
    p_status: parsed.data.status,
    // Ausente ao encerrar = a RPC usa a data de hoje (SP). Fora do
    // encerramento, a RPC ignora o término.
    p_ends_on: parsed.data.ends_on ?? undefined,
  });

  if (error) {
    return cadastroErrorResponse("[POST /api/contracts/[id]/status]", error);
  }

  const result = statusResultSchema.safeParse(data);
  if (!result.success) {
    console.error("[POST /api/contracts/[id]/status] retorno inesperado da RPC", data);
    return NextResponse.json(
      { ok: false, message: "Não foi possível concluir a operação." },
      { status: 500 }
    );
  }

  const { status, ends_on, changed } = result.data;
  return NextResponse.json({
    ok: true,
    message: changed ? STATUS_MESSAGE[status] : "Nada mudou.",
    contract: { id, status, ends_on },
    changed,
  });
}
