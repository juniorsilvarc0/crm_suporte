import { NextResponse } from "next/server";
import { z } from "zod";

import { SUBSCRIPTION_SELECT, toWebhookSubscription } from "@/features/webhooks/queries/get-webhooks";
import { webhookUpdateSchema } from "@/features/webhooks/schemas/webhook";
import { auditWebhook } from "@/features/webhooks/server/audit";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/security/ssrf-guard";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const idSchema = z.uuid();
type Params = { params: Promise<{ id: string }> };
const NO_ADMIN = { ok: false, message: "Supabase admin não está configurado neste ambiente." };

/** Edita o destino (admin): nome, URL (conferida de novo), eventos, ligar/pausar. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return NextResponse.json(NO_ADMIN, { status: 500 });

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ ok: false, message: "Destino inválido." }, { status: 400 });

  const body = await readJsonBody(request);
  if (body.error) return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });

  const parsed = webhookUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos destacados.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const patch: Database["public"]["Tables"]["webhook_subscriptions"]["Update"] = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.events !== undefined) patch.events = parsed.data.events;
  if (parsed.data.is_active !== undefined) patch.is_active = parsed.data.is_active;
  if (parsed.data.url !== undefined) {
    try {
      patch.url = assertSafeUrl(parsed.data.url).toString();
    } catch (error) {
      const message = error instanceof UnsafeUrlError ? error.message : "URL inválida.";
      return NextResponse.json({ ok: false, message, errors: { url: [message] } }, { status: 422 });
    }
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("webhook_subscriptions")
    .update(patch)
    .eq("id", id.data)
    .select(SUBSCRIPTION_SELECT)
    .maybeSingle();
  if (error) {
    console.error("[PATCH /api/webhooks/[id]]", error.code, error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível salvar o destino." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ ok: false, message: "Destino não encontrado." }, { status: 404 });
  // Os nomes dos campos, não os valores (a URL pode carregar token).
  await auditWebhook(supabase, "subscription.updated", {
    by: auth.viewer.id,
    subscriptionId: data.id,
    detail: { fields: Object.keys(patch).sort() },
  });
  return NextResponse.json({ ok: true, subscription: toWebhookSubscription(data) });
}

/** Exclui o destino (admin). O segredo sai do Vault junto (gatilho do banco). */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return NextResponse.json(NO_ADMIN, { status: 500 });

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ ok: false, message: "Destino inválido." }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("webhook_subscriptions")
    .delete()
    .eq("id", id.data)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[DELETE /api/webhooks/[id]]", error.code, error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível excluir o destino." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ ok: false, message: "Destino não encontrado." }, { status: 404 });
  await auditWebhook(supabase, "subscription.deleted", { by: auth.viewer.id, subscriptionId: data.id });
  return NextResponse.json({ ok: true });
}
