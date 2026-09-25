import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyWebhookAuth } from "@/lib/security/verify-webhook";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type Authorized = { supabase: SupabaseClient<Database>; error?: undefined };
type Unauthorized = { supabase?: undefined; error: NextResponse };

// Autoriza uma chamada da API de Integração (`/api/integracao/*`) pelo TOKEN DE
// API — a mesma credencial dos webhooks do n8n (header `x-webhook-secret` ou
// `Authorization: Bearer`). Retorna o client admin (service role) já pronto, ou
// um NextResponse de erro (401/500) para o handler devolver.
export async function authorizeIntegration(
  request: Request
): Promise<Authorized | Unauthorized> {
  if (!hasSupabaseAdminEnv()) {
    return {
      error: NextResponse.json(
        { ok: false, error: "supabase_env_missing" },
        { status: 500 }
      ),
    };
  }

  const supabase = createSupabaseAdminClient();
  const unauthorized = await verifyWebhookAuth(
    request,
    supabase,
    process.env.N8N_WEBHOOK_SECRET
  );
  if (unauthorized) {
    return { error: unauthorized };
  }

  return { supabase };
}

// Respostas padronizadas da API de Integração.
export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}
