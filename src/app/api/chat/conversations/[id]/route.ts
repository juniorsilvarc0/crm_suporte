import { NextResponse } from "next/server";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pushTakeoverToAgent } from "@/features/chat/lib/push-takeover";
import {
  AROUND_CONTEXT,
  MESSAGES_PAGE_SIZE,
  newerThanFilter,
  olderThanFilter,
  takePage,
} from "@/features/chat/lib/messages-page";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = createSupabaseAdminClient();

    // `before`/`beforeId` = cursor da mensagem mais antiga já na tela. Com eles
    // a chamada é "me dê a página ANTERIOR"; sem eles, é a abertura da conversa.
    const url = new URL(request.url);
    // `around=<id>` = "abra a conversa em volta desta mensagem", usado pelo
    // resultado da busca: o alvo pode estar 500 mensagens atrás da janela.
    const around = url.searchParams.get("around");
    if (around) return aroundResponse(supabase, id, around);

    const before = url.searchParams.get("before");
    const beforeId = url.searchParams.get("beforeId");
    const isPaging = Boolean(before && beforeId);

    // Busca as mensagens MAIS RECENTES (ordem desc + limit), não as mais
    // antigas. Ordenar asc com limit pegava o INÍCIO da conversa, então as
    // mensagens novas de um chat com +100 mensagens sumiam ao recarregar
    // (apareciam ao vivo pelo realtime, mas não vinham no load).
    //
    // `limit + 1` de propósito: a linha excedente responde "tem mais?" sem um
    // count separado. Ver features/chat/lib/messages-page.ts.
    let query = supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGES_PAGE_SIZE + 1);

    if (isPaging) {
      query = query.or(olderThanFilter({ createdAt: before as string, id: beforeId as string }));
    }

    const [convRes, msgsRes] = await Promise.all([
      supabase.from("chat_conversations").select("*").eq("id", id).single(),
      query,
    ]);

    if (convRes.error || !convRes.data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Zerar não-lidas é ação de ABRIR a conversa. Numa paginação seria escrita
    // à toa a cada clique em "carregar mais".
    if (!isPaging) {
      await supabase.from("chat_conversations").update({ unread_count: 0 }).eq("id", id);
    }

    const { page, hasMore } = takePage(msgsRes.data ?? [], MESSAGES_PAGE_SIZE);
    // A UI exibe do mais antigo para o mais novo: reverte a janela recente.
    const messages = page.slice().reverse();

    return NextResponse.json({
      conversation: convRes.data,
      messages,
      hasMore,
    });
  } catch (err) {
    console.error("[GET /api/chat/conversations/[id]]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Janela centrada numa mensagem: `AROUND_CONTEXT` antes + a própria + o mesmo
 * tanto depois. É o que o resultado da busca precisa — o alvo pode estar
 * centenas de mensagens atrás do que está carregado, e paginar até lá levaria
 * várias idas ao servidor.
 *
 * `hasMore` continua significando "há histórico ANTES desta janela", que é o
 * que o botão "carregar anteriores" pergunta.
 */
async function aroundResponse(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  conversationId: string,
  targetId: string
) {
  const [convRes, targetRes] = await Promise.all([
    supabase.from("chat_conversations").select("*").eq("id", conversationId).single(),
    supabase
      .from("chat_messages")
      .select("*")
      .eq("id", targetId)
      .eq("conversation_id", conversationId)
      .maybeSingle(),
  ]);

  if (convRes.error || !convRes.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!targetRes.data) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const cursor = { createdAt: targetRes.data.created_at, id: targetRes.data.id };

  const [olderRes, newerRes] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .or(olderThanFilter(cursor))
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(AROUND_CONTEXT + 1),
    supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .or(newerThanFilter(cursor))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(AROUND_CONTEXT),
  ]);

  const { page: older, hasMore } = takePage(olderRes.data ?? [], AROUND_CONTEXT);
  const messages = [
    ...older.slice().reverse(),
    targetRes.data,
    ...(newerRes.data ?? []),
  ];

  return NextResponse.json({ conversation: convRes.data, messages, hasMore });
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const viewer = await getDashboardViewer();
    if (!viewer) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      status?: string;
      action?: string;
    } | null;
    const supabase = createSupabaseAdminClient();

    const allowed = ["bot", "human", "resolved"];
    const marksUnread = body?.action === "mark-unread";
    const marksRead = body?.action === "mark-read";
    const archives = body?.action === "archive";
    const unarchives = body?.action === "unarchive";
    const pins = body?.action === "pin";
    const unpins = body?.action === "unpin";
    const hasAction =
      marksUnread || marksRead || archives || unarchives || pins || unpins;
    if (
      !body ||
      (body.action !== undefined && !hasAction) ||
      (!hasAction && (!body.status || !allowed.includes(body.status)))
    ) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Fixar guarda a DATA, não um booleano: é ela que ordena as fixadas entre
    // si, e desafixar é simplesmente voltar para `null`.
    if (pins || unpins) {
      const { data, error } = await supabase
        .from("chat_conversations")
        .update({
          pinned_at: pins ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ conversation: data });
    }

    if (archives || unarchives) {
      const { data, error } = await supabase
        .from("chat_conversations")
        .update({
          archived_at: archives ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ conversation: data });
    }

    if (marksRead) {
      const { data, error } = await supabase
        .from("chat_conversations")
        .update({ unread_count: 0, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ conversation: data });
    }

    if (marksUnread) {
      const updatedAt = new Date().toISOString();
      const marked = await supabase
        .from("chat_conversations")
        .update({ unread_count: 1, updated_at: updatedAt })
        .eq("id", id)
        .eq("unread_count", 0)
        .select()
        .maybeSingle();

      if (marked.error) throw marked.error;

      const current = marked.data
        ? marked
        : await supabase
            .from("chat_conversations")
            .select()
            .eq("id", id)
            .maybeSingle();

      if (current.error) throw current.error;
      if (!current.data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ conversation: current.data });
    }

    const { data, error } = await supabase
      .from("chat_conversations")
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Avisa o agente do takeover (background, best-effort): humano ASSUMIU
    // (status != 'bot' → assumed:true, pausa o bot) ou DEVOLVEU à IA
    // (status 'bot' → assumed:false, reativa). Sem isso o agente não enxerga o
    // "Assumir" e o bot continua respondendo. Não bloqueia a resposta; o helper
    // faz um retry e nunca lança.
    if (body.status && data?.external_id) {
      void pushTakeoverToAgent(data.external_id, body.status !== "bot");
    }

    return NextResponse.json({ conversation: data });
  } catch (err) {
    console.error("[PATCH /api/chat/conversations/[id]]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const viewer = await getDashboardViewer();
    if (!viewer) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const { id } = await params;
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode !== null && mode !== "clear") {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();

    if (mode === "clear") {
      const { data, error } = await supabase.rpc("clear_chat_conversation", {
        p_conversation_id: id,
      });
      if (error?.code === "P0002") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (error) throw error;
      if (!data || Array.isArray(data) || typeof data !== "object") {
        throw new Error("invalid_clear_conversation_response");
      }

      return NextResponse.json(data);
    }

    const { data, error } = await supabase
      .from("chat_conversations")
      .update({
        removed_at: new Date().toISOString(),
        archived_at: null,
        pinned_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, id: data.id });
  } catch (err) {
    console.error("[DELETE /api/chat/conversations/[id]]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
