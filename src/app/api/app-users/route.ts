import { NextResponse } from "next/server";

import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { getAppUsers } from "@/features/settings/queries/get-app-users";
import { resolveSignature } from "@/features/chat/lib/signature";

export const runtime = "nodejs";

// Lista enxuta da equipe (id + nome) para o select "Agendado por" do dialog de
// agendamento — que é client e não pode ler app_users (service_role-only) direto.
// Devolve também o usuário logado para o formulário já vir com ele preenchido.
export async function GET() {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  const users = await getAppUsers();
  return NextResponse.json({
    ok: true,
    users: users
      .filter((user) => user.is_active)
      .map((user) => ({ id: user.id, name: user.name })),
    currentUserId: viewer.id,
    // Como as mensagens deste operador serão assinadas — a MESMA regra que a
    // rota de envio aplica. O chat precisa disso para a bolha otimista já nascer
    // com o texto final; sem ela, a assinatura brotava um segundo depois e a
    // bolha crescia sozinha. É o apelido do próprio usuário, não é segredo.
    currentUserSignature: resolveSignature(viewer),
  });
}
