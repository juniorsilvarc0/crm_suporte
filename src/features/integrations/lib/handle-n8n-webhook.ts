import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";

import { recordIntegrationLog } from "@/features/integrations/queries/record-integration-log";
import { readJsonBody } from "@/lib/http/read-json-body";
import { verifyWebhookAuth } from "@/lib/security/verify-webhook";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";

type N8nWebhookOptions<T> = {
  // Nome da ação, usado no log de integração (ex.: "lead", "appointment").
  action: string;
  // Schema Zod opcional; se o payload não passar, responde 400 invalid_payload.
  schema?: ZodType<T>;
  // Executa a mutação e devolve o payload a registrar no log de sucesso.
  run: (supabase: SupabaseClient<Database>, data: T) => Promise<Json>;
};

// Boilerplate compartilhado das rotas de webhook do n8n: confere o ambiente
// Supabase, cria o client admin, autentica (segredo do ambiente OU token de API),
// lê/valida o corpo, executa e registra o log de integração (sucesso ou erro).
export async function handleN8nWebhook<T = unknown>(
  request: Request,
  { action, schema, run }: N8nWebhookOptions<T>
) {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, error: "supabase_env_missing" },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();

  const unauthorized = await verifyWebhookAuth(
    request,
    supabase,
    process.env.N8N_WEBHOOK_SECRET
  );
  if (unauthorized) {
    return unauthorized;
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, error: body.error }, { status: 400 });
  }

  let data = body.data as T;
  if (schema) {
    const parsed = schema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "invalid_payload" },
        { status: 400 }
      );
    }
    data = parsed.data;
  }

  try {
    const logPayload = await run(supabase, data);
    await recordIntegrationLog(supabase, {
      provider: "n8n",
      direction: "inbound",
      action,
      status: "ok",
      payload: logPayload,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await recordIntegrationLog(supabase, {
      provider: "n8n",
      direction: "inbound",
      action,
      status: "error",
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return NextResponse.json(
      { ok: false, error: "webhook_failed" },
      { status: 500 }
    );
  }
}
