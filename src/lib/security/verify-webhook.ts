import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hashApiToken } from "@/lib/security/api-token";
import type { Database } from "@/lib/supabase/types";

// Extrai o segredo enviado: header `x-webhook-secret` ou `Authorization: Bearer`.
function extractSecret(request: Request): string | null {
  const header = request.headers.get("x-webhook-secret");
  if (header) return header.trim();

  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  return null;
}

// Autentica um webhook aceitando DUAS formas de credencial:
//  1. o segredo compartilhado do ambiente (`N8N_WEBHOOK_SECRET`) — retrocompatível;
//  2. qualquer token de API gerado na UI que não esteja revogado.
// Retorna `null` quando autorizado, ou um `NextResponse` 401 quando não.
export async function verifyWebhookAuth(
  request: Request,
  supabase: SupabaseClient<Database>,
  envSecret?: string
): Promise<NextResponse | null> {
  const received = extractSecret(request);
  if (!received) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const receivedHash = hashApiToken(received);

  // 1) Segredo do ambiente (comparado por hash de tamanho fixo).
  if (envSecret && receivedHash === hashApiToken(envSecret)) {
    return null;
  }

  // 2) Token de API gerado pela UI.
  const { data } = await supabase
    .from("api_tokens")
    .select("id")
    .eq("token_hash", receivedHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  // Marca o uso sem bloquear a resposta do webhook.
  //
  // O `.then()` NÃO é decorativo: o query builder do supabase-js é preguiçoso e
  // só dispara o HTTP quando alguém o consome. Um `void builder` sozinho monta a
  // query e a joga fora sem nunca executá-la — era esse o bug: `last_used_at`
  // ficava eternamente nulo, e a coluna "último uso" da tela de Tokens de API
  // mentia para todos os tokens.
  //
  // O erro é engolido de propósito: o token JÁ foi autenticado, e falhar em
  // registrar o uso não pode derrubar o webhook.
  void supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(
      () => undefined,
      () => undefined
    );

  return null;
}
