import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeLikePattern } from "@/features/chat/lib/search-term";

type Params = { params: Promise<{ id: string }> };

/** Teto de resultados. Quem precisa de mais que isso deve refinar o termo. */
const MAX_HITS = 60;

/**
 * Busca dentro de UMA conversa.
 *
 * Precisa ser no servidor: a tela carrega 100 mensagens por vez, e a maior
 * conversa tem 684 — buscar só no que está na tela acharia menos de um sexto.
 *
 * Devolve a mensagem inteira, não um trecho: quem chama monta a prévia e usa o
 * `id` para pedir a janela ao redor (`?around=`).
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const term = (new URL(request.url).searchParams.get("q") ?? "").trim();

    // Termo de 1 caractere casaria com quase tudo e não ajuda ninguém.
    if (term.length < 2) {
      return NextResponse.json({ hits: [], term });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, content, direction, type, created_at")
      .eq("conversation_id", id)
      .eq("is_deleted", false)
      .ilike("content", `%${escapeLikePattern(term)}%`)
      .order("created_at", { ascending: false })
      .limit(MAX_HITS);

    if (error) {
      console.error("[chat/search]", error.message);
      return NextResponse.json({ hits: [], term });
    }

    return NextResponse.json({ hits: data ?? [], term });
  } catch (err) {
    console.error("[GET /api/chat/conversations/[id]/search]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
