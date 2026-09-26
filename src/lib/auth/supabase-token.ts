import { SignJWT } from "jose";

import type { AppUserRole } from "@/features/settings/types";

/**
 * Token de acesso do navegador ao Supabase — o que substitui a chave anônima.
 *
 * ⚠️ POR QUE ISTO EXISTE. O `supabase-js` do navegador se identificava com a
 * chave `anon`, que é **pública por natureza**: ela vai embutida no bundle e
 * qualquer pessoa a lê no DevTools. Como a RLS do chat concede `select` a `anon`
 * com `using (true)` — exceção deliberada para o Realtime funcionar —, expor o
 * PostgREST na internet com essa chave entregaria o histórico de conversas de
 * todos os clientes a quem pedisse.
 *
 * A saída é o navegador deixar de ser `anon` e passar a ser `authenticated`,
 * com um token curto emitido a partir do cookie de sessão. Aí a RLS pode fechar
 * `anon` completamente (ver a migration de blindagem).
 *
 * ⚠️ Este segredo é o do SUPABASE, não o da sessão do app. São dois JWT
 * diferentes, com dois segredos diferentes e dois públicos diferentes:
 *   - `AUTH_JWT_SECRET`  → cookie de sessão (`AUTH_COOKIE`), lido só pelo nosso servidor
 *   - `SUPABASE_JWT_SECRET` → este, validado pelo PostgREST e pelo Realtime
 * Reaproveitar um no lugar do outro faria o Supabase aceitar cookie de sessão
 * como credencial de banco.
 */

/** Quinze minutos: curto o bastante para um vazamento envelhecer sozinho. */
export const SUPABASE_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * O mesmo segredo de demonstração que o `docker-compose.yml` local usa. Vale só
 * fora de produção, para o ambiente de desenvolvimento subir sem configuração
 * extra — em produção a ausência da variável é erro, nunca um valor padrão.
 */
const DEV_FALLBACK_SECRET =
  "super-secret-jwt-token-with-at-least-32-characters-long";

function getSupabaseJwtSecret(): Uint8Array {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SUPABASE_JWT_SECRET ausente ou curto (mín. 32 caracteres): obrigatório em produção."
    );
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export type SupabaseAccessToken = {
  token: string;
  /** Epoch em SEGUNDOS, como o `exp` do JWT — o cliente renova antes disso. */
  expiresAt: number;
};

/**
 * Emite o token `authenticated` para um usuário já autenticado pelo app.
 *
 * ⚠️ Não há verificação de sessão AQUI de propósito: quem chama é uma rota que
 * já provou a sessão contra o banco. Manter esta função burra é o que a torna
 * testável sem runtime do Next.
 *
 * O `sub` é o id do usuário do app. O PostgREST o expõe em
 * `request.jwt.claims`, então uma policy futura pode filtrar por usuário sem
 * precisar de nada novo daqui.
 *
 * ⚠️ O `app_role` NÃO é decoração. Todo mundo aqui recebe o mesmo papel de
 * banco (`authenticated`), então sem este claim a RLS não teria como separar
 * papéis com acessos diferentes — a policy de chat só aceita `admin` e
 * `member`, e deixa de fora qualquer papel novo por padrão. Sem ele, qualquer
 * usuário logado leria todas as conversas
 * chamando o PostgREST direto, contornando o guard de rota do app. As policies
 * de chat leem exatamente este claim.
 */
export async function createSupabaseAccessToken(
  userId: string,
  appRole: AppUserRole
): Promise<SupabaseAccessToken> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SUPABASE_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({ role: "authenticated", app_role: appRole })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    // `aud` é o que o PostgREST confere quando `PGRST_JWT_AUD` está definido, e
    // é o valor que o Supabase usa por convenção. Sem ele, um PostgREST
    // configurado com audiência recusaria o token sem dizer por quê.
    .setAudience("authenticated")
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(getSupabaseJwtSecret());

  return { token, expiresAt };
}
