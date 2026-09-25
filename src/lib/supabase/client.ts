import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

// Singleton do client de browser: criar um novo a cada chamada gera vários
// GoTrueClient com a mesma storage key ("Multiple GoTrueClient instances").
let browserClient: SupabaseClient<Database> | undefined;

/**
 * Token `authenticated` em memória, com a validade que o servidor informou.
 *
 * ⚠️ Vive só nesta variável, nunca em `localStorage` nem em cookie legível por
 * script: o ponto de trocar a chave anônima por um token curto é justamente
 * reduzir o que um XSS consegue levar embora.
 */
let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string | null> | null = null;

/**
 * Renova com folga: o relógio do navegador pode estar adiantado, e uma
 * requisição em voo não pode ser recusada por um token que venceu no caminho.
 */
const RENEW_MARGIN_SECONDS = 60;

async function fetchAccessToken(): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/supabase-token", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      // 401 é o caso normal de sessão expirada: a tela vai redirecionar para o
      // login por outro caminho. Ruído no console aqui só atrapalha o
      // diagnóstico de problema de verdade.
      cached = null;
      return null;
    }
    const payload = (await response.json()) as { token?: string; expiresAt?: number };
    if (!payload.token || !payload.expiresAt) {
      cached = null;
      return null;
    }
    cached = { token: payload.token, expiresAt: payload.expiresAt };
    return cached.token;
  } catch {
    cached = null;
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - RENEW_MARGIN_SECONDS > now) {
    return cached.token;
  }
  // Uma renovação por vez: o `supabase-js` chama isto a CADA request REST e a
  // cada reconexão do Realtime. Sem esta trava, abrir o chat dispararia várias
  // buscas simultâneas do mesmo token.
  inFlight ??= fetchAccessToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Client do navegador.
 *
 * ⚠️ A chave anônima continua sendo passada porque o Supabase a exige como
 * `apikey` (é o identificador do projeto), mas ela NÃO é mais a credencial: o
 * `accessToken` abaixo faz o `supabase-js` mandar um token `authenticated` no
 * `Authorization`, tanto no REST quanto no Realtime. Depois da migration de
 * blindagem, `anon` não alcança nada — então, se a emissão do token falhar, a
 * consulta é RECUSADA em vez de cair silenciosamente para acesso anônimo.
 *
 * ⚠️ Com `accessToken` definido, o `supabase-js` substitui `supabase.auth` por
 * um Proxy que lança erro em qualquer acesso. O projeto não usa `supabase.auth`
 * (a autenticação é o cookie de sessão (`AUTH_COOKIE`)), então isso é irrelevante hoje — e é
 * bom que quebre alto se alguém tentar usar.
 */
export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase browser env vars are missing.");
  }

  if (!browserClient) {
    browserClient = createClient<Database>(supabaseUrl, anonKey, {
      accessToken: getAccessToken,
    });
  }

  return browserClient;
}

/** Só para teste: zera o token guardado entre casos. */
export function __resetSupabaseBrowserTokenCache() {
  cached = null;
  inFlight = null;
}
