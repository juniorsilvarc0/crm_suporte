import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Teto de segurança: 425 conversas hoje, com no máximo um punhado de etiquetas cada. */
const MAX_PAIRS = 5000;

const EMPTY = { tags: [], pairs: [] };

/**
 * Etiquetas do chat: o catálogo inteiro e todos os vínculos, numa ida só.
 *
 * Duas coisas na mesma resposta de propósito. A lista precisa dos vínculos para
 * pintar os chips e o seletor precisa do catálogo — buscar em duas rotas faria
 * a tela abrir com chip sem nome ou seletor sem marcação, dependendo de qual
 * resposta chegasse primeiro.
 *
 * Uma query para tudo, nunca uma por conversa: com 425 linhas na lista, N+1
 * aqui seriam 425 idas ao banco só para desenhar a primeira tela.
 *
 * Vive no servidor porque `conversation_tags` tem RLS sem policy — só a service
 * role enxerga. Isso é deliberado (ver a migration): a etiqueta não passa por
 * Realtime e não justifica ampliar a superfície do `anon`.
 *
 * Erro devolve vazio e loga, como `getDeals`: sem etiqueta a lista de conversas
 * continua inteira e utilizável, e derrubá-la por causa do enfeite seria pior.
 */
export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();

    const [catalog, links] = await Promise.all([
      supabase.from("tags").select("id, name, color, created_at").order("name"),
      supabase
        .from("conversation_tags")
        .select("conversation_id, tag_id")
        .limit(MAX_PAIRS),
    ]);

    if (catalog.error) {
      console.error("[GET /api/chat/conversations/tags] tags:", catalog.error.message);
      return NextResponse.json(EMPTY);
    }
    if (links.error) {
      console.error("[GET /api/chat/conversations/tags] vínculos:", links.error.message);
      // O catálogo sozinho ainda serve: dá para abrir o seletor e etiquetar.
      return NextResponse.json({ tags: catalog.data ?? [], pairs: [] });
    }

    return NextResponse.json({
      tags: catalog.data ?? [],
      pairs: links.data ?? [],
    });
  } catch (err) {
    console.error("[GET /api/chat/conversations/tags] threw", err);
    return NextResponse.json(EMPTY);
  }
}
