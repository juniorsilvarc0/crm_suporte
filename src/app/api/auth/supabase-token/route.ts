import { NextResponse } from "next/server";

import { createSupabaseAccessToken } from "@/lib/auth/supabase-token";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const runtime = "nodejs";
// Token tem validade curta e é por usuário: cache em qualquer camada seria
// entregar a credencial de um operador para outro.
export const dynamic = "force-dynamic";

/**
 * Emite o token que o navegador usa para falar com o Supabase.
 *
 * A autorização é a MESMA das telas: sessão válida e usuário ativo, conferidos
 * no banco por `getDashboardViewer` — não no JWT do cookie. Assim, desativar um
 * usuário corta o acesso dele ao banco em no máximo 15 minutos (a validade do
 * token já emitido), sem precisar revogar nada.
 *
 * ⚠️ O token dá o papel `authenticated`, que hoje enxerga só as duas tabelas de
 * chat. Se um dia alguém ampliar o que `authenticated` alcança, estará ampliando
 * o que qualquer operador logado pode ler chamando o PostgREST direto, fora das
 * rotas do app. Ver a migration de blindagem antes de conceder qualquer coisa.
 */
export async function GET() {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, message: "Sessão inválida." },
      { status: 401 }
    );
  }

  // O papel vai no token porque a RLS precisa dele: todos recebem o mesmo papel
  // de banco (`authenticated`), e é o claim que separa quem opera o chat de
  // quem só vê Rastreamento. Vem do BANCO, então rebaixar alguém tem efeito no
  // próximo token — no máximo 15 minutos.
  const { token, expiresAt } = await createSupabaseAccessToken(viewer.id, viewer.role);

  return NextResponse.json(
    { ok: true, token, expiresAt },
    { headers: { "Cache-Control": "no-store" } }
  );
}
