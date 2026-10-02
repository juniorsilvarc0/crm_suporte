// Decisão de acesso por rota, isolada do runtime do Next para ser testável.
// O proxy (middleware) só traduz a decisão em resposta HTTP.

import type { AppUserRole } from "@/features/settings/types";

export type GuardDecision =
  | { type: "allow" }
  | { type: "unauthorized" }
  | { type: "forbidden" }
  | { type: "redirect-login"; redirectTo: string }
  | { type: "redirect-app" };

// Páginas que exigem sessão do dashboard.
const PROTECTED_PAGE_PREFIXES = ["/app", "/admin", "/definir-senha"];

// Páginas restritas a administradores. O proxy redireciona rápido pelo
// papel do JWT (307 no edge); a página confirma com o papel FRESCO do banco
// (getDashboardViewer), pegando o caso de um admin recém-rebaixado com cookie
// antigo. Manter em sincronia com `allowedRoles` de config/navigation.ts.
const ADMIN_PAGE_PREFIXES = [
  "/app/conexao",
  "/app/equipe",
  "/app/configuracoes",
];

// Rotas de /api com autenticação PRÓPRIA — não passam pelo guard de sessão do
// dashboard:
//   - /api/chat/webhook/* → uazapi, verificação própria
//   - /api/auth/*        → login e logout
//   - /api/v1/*          → API para integradores e para a IA: token com escopo,
//                          conferido por withApi (src/lib/api/v1/with-api.ts);
//                          src/app/api/v1/api-v1-guards.test.ts garante
// Prefixo novo aqui = handler que PRECISA autenticar sozinho.
const PUBLIC_API_PREFIXES = [
  "/api/chat/webhook/",
  "/api/auth/",
  "/api/v1/",
];

export function isPublicApiRoute(pathname: string) {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Rotas de /api chamadas por SERVIDORES, com credencial própria e sem o cookie
// de sessão (a uazapi no webhook, integradores na API v1): a origem do pedido
// não diz nada sobre elas. `/api/auth/*` NÃO está aqui: login e definir senha
// são da tela, e definir senha confia só no cookie.
const ORIGIN_EXEMPT_API_PREFIXES = ["/api/chat/webhook/", "/api/v1/"];

// A isenção é estreita de propósito: o prefixo escrito assim mesmo, e nenhum `%`
// no caminho. `..` já chega resolvido; codificado (`/api/v1/..%2fapp-users`) ele
// começa com o prefixo isento, e a trava não pode depender de o roteador não o
// decodificar. Nenhuma rota do webhook ou da v1 precisa de `%` no caminho.
function isOriginExempt(pathname: string) {
  return (
    !pathname.includes("%") &&
    ORIGIN_EXEMPT_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Os valores chegam como o `Headers` os entrega: sem espaço em volta. A regra
// não os "conserta": método ou `Sec-Fetch-Site` em outra caixa não é o que um
// navegador manda, e cai do lado da recusa.
export type WriteOrigin = {
  method: string;
  /** `Sec-Fetch-Site`: o navegador diz de onde o pedido partiu. Uma página não o forja. */
  secFetchSite: string | null;
  /** `Origin`: vale só quando o navegador não manda o cabeçalho acima. */
  origin: string | null;
  /** Os hosts pelos quais este app atende (o `Host` do pedido, o da URL pública). */
  ownHosts: readonly (string | null | undefined)[];
};

/**
 * Um pedido de ESCRITA (todo método que não é GET, HEAD ou OPTIONS) vindo de
 * OUTRA origem. Leitura fica de fora: link, imagem e navegação vindos de outro
 * lugar são legítimos. Por isso rota que muda estado não pode ser GET.
 *
 * O cookie de sessão é `SameSite=Lax`: ele não acompanha um POST vindo de outro
 * SITE, mas acompanha o de outro subdomínio do mesmo site (ou de outra porta em
 * localhost), e o corpo em `text/plain` passa sem preflight. Sem esta trava, uma
 * página de outro subdomínio escreve no CRM em nome de quem está logado.
 *
 * Vale para todo caminho que o proxy vê, e não só para `/api/`: página não
 * recebe escrita, e assim a trava não depende de o proxy e o roteador lerem o
 * caminho do mesmo jeito (`/%61pi/...` não é `/api/...` para um, e poderia ser
 * para o outro).
 *
 * A decisão, na ordem:
 * - quando o navegador diz a origem (`Sec-Fetch-Site`), só passa `same-origin`
 *   (a própria tela) e `none` (ação direta do usuário);
 * - sem esse cabeçalho (navegador antigo, ou HTTP fora de localhost), vale o
 *   `Origin`: recusa se ele é de outro host. Só o host é comparado; http contra
 *   https no mesmo host fica com o HSTS;
 * - sem nenhum dos dois, não é navegador (curl, outro servidor): não há cookie
 *   de vítima para abusar, e o pedido segue para a checagem de sessão de sempre.
 */
export function isCrossOriginWrite(pathname: string, request: WriteOrigin): boolean {
  if (isOriginExempt(pathname)) return false;
  if (SAFE_METHODS.has(request.method)) return false;

  const site = request.secFetchSite;
  if (site) return site !== "same-origin" && site !== "none";

  if (!request.origin) return false;

  let host: string;
  try {
    // O parser já devolve o host em minúsculas, e com a porta quando não é a padrão.
    host = new URL(request.origin).host;
  } catch {
    // `Origin: null` (iframe isolado, redirecionamento entre origens) e lixo.
    return true;
  }
  // Origem sem host (`file://`) nunca é a do app, nem que um host próprio venha vazio.
  if (!host) return true;
  return !request.ownHosts.some((own) => own?.toLowerCase() === host);
}

export function decideRouteAccess(
  pathname: string,
  hasValidSession: boolean,
  role?: AppUserRole | null
): GuardDecision {
  // Rotas internas de /api: exigem sessão. Sem ela → 401 (não redirect, que é
  // comportamento de página). Webhooks e auth têm autenticação própria.
  if (pathname.startsWith("/api/")) {
    if (isPublicApiRoute(pathname)) return { type: "allow" };
    if (!hasValidSession) return { type: "unauthorized" };
    return { type: "allow" };
  }

  // Páginas protegidas sem sessão → login, preservando o destino.
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (isProtectedPage && !hasValidSession) {
    return { type: "redirect-login", redirectTo: pathname };
  }

  // Página administrativa acessada por não-admin → volta para o app.
  const isAdminPage = ADMIN_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (isAdminPage && hasValidSession && role !== "admin") {
    return { type: "redirect-app" };
  }

  // Já autenticado tentando ver /login → manda para o app.
  if (pathname === "/login" && hasValidSession) {
    return { type: "redirect-app" };
  }

  return { type: "allow" };
}
