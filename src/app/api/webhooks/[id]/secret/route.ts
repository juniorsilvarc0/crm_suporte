import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditWebhook } from "@/features/webhooks/server/audit";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const idSchema = z.uuid();
type Params = { params: Promise<{ id: string }> };

function reply(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * Troca o segredo da assinatura (admin). O novo é gerado pelo CRM e volta UMA
 * vez, nesta resposta. Vale na próxima entrega: entre a troca e a configuração
 * no destino, ele recusa a assinatura e as entregas entram em nova tentativa.
 *
 * Como na chave do agente (connection/agent/signing-secret), a releitura decide
 * o que ficou guardado: o erro ao gravar pode ter vindo depois do commit, e
 * duas trocas quase juntas gravam as duas — só a última vale.
 */
export async function POST(_request: Request, { params }: Params) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return reply(500, "Supabase admin não está configurado neste ambiente.");

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return reply(400, "Destino inválido.");

  const supabase = createSupabaseAdminClient();
  const secret = randomBytes(32).toString("hex");
  const { error } = await supabase.rpc("set_webhook_subscription_secret", {
    p_subscription_id: id.data,
    p_value: secret,
  });
  if (error?.code === "P0002") return reply(404, "Destino não encontrado.");
  // Só o código vai para o log (o pedido levava o segredo).
  if (error) console.error("[POST /api/webhooks/[id]/secret]", error.code ?? "sem código");

  const stored = await supabase.rpc("get_webhook_subscription_secret", { p_subscription_id: id.data });
  if (stored.error) {
    console.error("[POST /api/webhooks/[id]/secret] conferir", stored.error.code ?? "sem código");
    // Sem a conferência, vale o que o banco respondeu ao gravar.
    if (error) return reply(500, "Não foi possível trocar o segredo.");
  } else if (stored.data !== secret) {
    return error
      ? reply(500, "Não foi possível trocar o segredo.")
      : reply(409, "Outra troca do segredo aconteceu ao mesmo tempo. Confira e troque de novo.");
  }

  await auditWebhook(supabase, "secret.rotated", { by: auth.viewer.id, subscriptionId: id.data });
  return NextResponse.json({ ok: true, secret }, { headers: { "Cache-Control": "no-store" } });
}
