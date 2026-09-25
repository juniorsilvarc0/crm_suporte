import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Assina um canal do Realtime só DEPOIS de o token `authenticated` estar no
 * socket. Devolve a função que desfaz a assinatura.
 *
 * ⚠️ Sem esperar o `setAuth()`, o join sai com a chave anônima sempre que a
 * busca do token (`/api/auth/supabase-token`) perde a corrida para a abertura
 * do WebSocket. O Realtime grava a assinatura de `postgres_changes` como
 * `anon`, e todo evento chega vazio, com "Error 401: Unauthorized". O token
 * que chega depois não corrige uma assinatura já gravada. Medido no stack
 * local: com o token atrasado 150 ms, `realtime.subscription.claims_role`
 * ficava `anon`; esperando o `setAuth()`, `authenticated`.
 */
export function subscribeAuthenticated(
  build: (supabase: SupabaseClient<Database>) => RealtimeChannel
): () => void {
  const supabase = createSupabaseBrowserClient();
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  void (async () => {
    // Sem token (sessão expirada) o canal nem é criado: a tela volta ao login
    // por outro caminho, e assinar como anônimo não entregaria nada.
    if (!(await getAccessToken()) || cancelled) return;
    // Sem argumento: o socket segue renovando pelo `accessToken` do client.
    await supabase.realtime.setAuth();
    if (!cancelled) channel = build(supabase).subscribe();
  })().catch((error) => {
    console.error("[realtime] assinatura falhou", error);
  });

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

/** Só para teste: zera o token guardado entre casos. */
export function __resetSupabaseBrowserTokenCache() {
  cached = null;
  inFlight = null;
}
