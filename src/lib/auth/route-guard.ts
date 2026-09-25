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

// Rotas de /api com autenticação PRÓPRIA (segredo/token) — não passam pelo
// guard de sessão do dashboard:
//   - /api/webhooks/*    → n8n, valida `x-webhook-secret`
//   - /api/chat/webhook/* → uazapi, verificação própria
//   - /api/integracao/*  → API de Integração (agentes de IA), token de API
//   - /api/auth/*        → login e logout
const PUBLIC_API_PREFIXES = [
  "/api/webhooks/",
  "/api/chat/webhook/",
  "/api/integracao/",
  "/api/auth/",
];

export function isPublicApiRoute(pathname: string) {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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
