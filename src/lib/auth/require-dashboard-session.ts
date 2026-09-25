import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { AUTH_COOKIE, verifySessionToken, type SessionUser } from "@/lib/auth/session";
import { getAppUser } from "@/features/settings/queries/get-app-users";
import type { AppUser } from "@/features/settings/types";

// Usuário da sessão atual (ou null). Fonte única de "quem está logado".
export async function getDashboardSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(AUTH_COOKIE)?.value);
}

export async function hasDashboardSession(): Promise<boolean> {
  return (await getDashboardSession()) !== null;
}

// Perfil atual consultado no banco: papel e bloqueio passam a valer mesmo
// quando o cookie foi emitido antes de uma alteração feita pelo administrador.
export async function getDashboardViewer(
  sessionOverride?: SessionUser | null
): Promise<AppUser | null> {
  const session =
    sessionOverride === undefined ? await getDashboardSession() : sessionOverride;
  if (!session) return null;
  const viewer = await getAppUser(session.id);
  return viewer?.is_active ? viewer : null;
}

// Exige um administrador ativo para rotas administrativas (gerar/revogar tokens
// de API, gerenciar a conexão do WhatsApp, mudar a URL de relay do bot). Retorna
// o viewer autorizado, ou um NextResponse pronto (401/403) para a rota devolver.
// O papel é lido do BANCO (getDashboardViewer), não do JWT — então rebaixar um
// usuário tem efeito imediato, mesmo com cookie antigo.
export async function requireDashboardAdmin(): Promise<
  { viewer: AppUser } | { error: NextResponse }
> {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return { error: NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 }) };
  }
  if (viewer.role !== "admin") {
    return {
      error: NextResponse.json(
        { ok: false, message: "Apenas administradores podem executar esta ação." },
        { status: 403 }
      ),
    };
  }
  return { viewer };
}

// Rastreamento é a única área compartilhada entre admin e tráfego pago.
// A leitura fresca do banco faz uma troca de papel valer nesta própria rota.
export async function requireDashboardTracking(): Promise<
  { viewer: AppUser } | { error: NextResponse }
> {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return { error: NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 }) };
  }
  if (viewer.role !== "admin" && viewer.role !== "paid_traffic") {
    return {
      error: NextResponse.json(
        { ok: false, message: "Seu perfil não possui acesso ao Rastreamento." },
        { status: 403 }
      ),
    };
  }
  return { viewer };
}

// Exige apenas um usuário ATIVO — sem exigir papel. É o guard das ações que
// pertencem a quem atende, não a quem administra (respostas rápidas). Diferente
// de `hasDashboardSession`, o estado vem do BANCO: um usuário desativado com
// cookie válido não passa daqui.
export async function requireDashboardUser(): Promise<
  { viewer: AppUser } | { error: NextResponse }
> {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return { error: NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 }) };
  }
  if (viewer.role === "paid_traffic") {
    return {
      error: NextResponse.json(
        { ok: false, message: "Seu perfil possui acesso somente ao Rastreamento." },
        { status: 403 }
      ),
    };
  }
  return { viewer };
}

// Guard de PÁGINA administrativa (Server Component): exige admin ativo, senão
// redireciona — sem sessão vai para logout; membro vai para o dashboard. Retorna
// o viewer para a página reusar (nome, id, etc.).
export async function requireAdminPage(): Promise<AppUser> {
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");
  if (viewer.role === "paid_traffic") redirect("/app/rastreamento");
  if (viewer.role !== "admin") redirect("/app");
  return viewer;
}

export async function requireTrackingPage(): Promise<AppUser> {
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");
  if (viewer.role !== "admin" && viewer.role !== "paid_traffic") redirect("/app");
  return viewer;
}
