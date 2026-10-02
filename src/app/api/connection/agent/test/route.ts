import { NextResponse } from "next/server";

import { pingAgent } from "@/features/integrations/server/relay-ping";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Teto de testes por administrador. Cada teste é um pedido do servidor a um
// endereço de fora, e a resposta diz o status e o tempo: sem teto, o botão
// serviria para sondar endereços em série. (O contador é por processo: com
// duas réplicas, o teto real é o dobro.)
const PINGS_PER_MINUTE = 10;

// "Testar conexão" do agente: um `webhook.ping` à URL SALVA, pelo mesmo caminho
// do repasse (guarda de URL, chave do cofre, cabeçalhos, prazo de 10 s). Não
// recebe URL no corpo: testar um endereço que não é o salvo diria "funciona"
// sobre o que o repasse não usa.
//
// Responde 200 com o desfecho em `result`, inclusive quando o agente falha: a
// rota funcionou, quem não respondeu foi o agente.
export async function POST() {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase não configurado." },
      { status: 500 }
    );
  }

  const limit = rateLimit(`agent-ping:${auth.viewer.id}`, PINGS_PER_MINUTE, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: `Muitos testes seguidos. Tente de novo em ${limit.retryAfter} s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const result = await pingAgent(createSupabaseAdminClient());
  return NextResponse.json({ ok: true, result });
}
