import { DashboardShell } from "@/components/layout/dashboard-shell";
import { redirect } from "next/navigation";
import {
  getDashboardSession,
  getDashboardViewer,
} from "@/lib/auth/require-dashboard-session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getDashboardSession();
  const viewer = await getDashboardViewer(session);
  // JWT válido mas usuário inválido (desativado/removido): desloga de verdade
  // (limpa o cookie) em vez de mandar para /login — senão o middleware devolve
  // /login → /app em loop.
  if (!viewer) redirect("/api/auth/logout");
  // Papel alterado durante uma sessão: força novo login para o JWT não
  // preservar permissões antigas até expirar.
  if (!session || session.role !== viewer.role) redirect("/api/auth/logout");
  // Primeiro acesso com senha temporária: bloqueia o app até definir a própria
  // senha. A página /definir-senha não está sob /app, então não há loop.
  if (viewer.must_change_password) redirect("/definir-senha");
  return <DashboardShell viewer={{ displayName: viewer.name, email: viewer.email, avatarUrl: viewer.avatar_url, avatarColor: viewer.avatar_color, role: viewer.role }}>{children}</DashboardShell>;
}
