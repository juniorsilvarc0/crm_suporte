import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { CLIENT_ID_PATTERN } from "@/features/chat/lib/outgoing-message";
import { sendOutboundText } from "@/features/chat/lib/send-outbound";
import { resolveSignature, signMessage } from "@/features/chat/lib/signature";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;
  // Quem está falando: define a assinatura e fica registrado na mensagem.
  const { viewer } = auth;

  try {
    const { id } = await params;
    const { content, kind, quotedMessageId, clientId } = (await request.json()) as {
      content: string;
      kind?: "note" | "text";
      /** Id da NOSSA chat_messages sendo respondida. */
      quotedMessageId?: string | null;
      /**
       * Identificador do envio, criado pela tela. Casa a bolha otimista com esta
       * linha e torna o reenvio idempotente.
       */
      clientId?: string | null;
    };

    if (!content?.trim()) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }

    // Charset restrito porque o valor entra num filtro do PostgREST — vírgula e
    // parêntese ali seriam sintaxe, não dado.
    if (clientId != null && !CLIENT_ID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();

    const { data: conv, error: convErr } = await supabase
      .from("chat_conversations")
      .select("id, external_id, contact_phone, integration_id")
      .eq("id", id)
      .single();

    if (convErr || !conv) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isNote = kind === "note";
    const now = new Date().toISOString();

    // --- Notas internas: nunca vão ao provedor, salvas só localmente ---------
    if (isNote) {
      const { data: note, error: noteErr } = await supabase
        .from("chat_messages")
        .insert({
          conversation_id: id,
          direction: "outbound",
          sender_type: "agent",
          type: "note",
          content,
          delivery_status: "sent",
          sent_by_user_id: viewer.id,
          created_at: now,
        })
        .select()
        .single();
      if (noteErr) throw noteErr;
      return NextResponse.json({ message: note });
    }

    // --- Texto de saída: resolve integração, insere pending, envia -----------
    // O caminho é o de send-outbound.ts (o mesmo da API v1). Aqui quem assina a
    // linha é o analista, e a assinatura dele vai no texto: apelido, ou 1º
    // nome; nada se ele desmarcou. Notas internas nunca são assinadas.
    const result = await sendOutboundText(supabase, {
      conversation: conv,
      content,
      finalize: (text) => signMessage(text, resolveSignature(viewer)),
      clientId: clientId ?? null,
      quotedMessageId: quotedMessageId ?? null,
      author: { kind: "user", userId: viewer.id },
      now,
    });

    if (!result.ok) {
      switch (result.reason) {
        case "no_phone":
          return NextResponse.json({ error: "No phone on conversation" }, { status: 400 });
        case "no_integration":
          return NextResponse.json({ error: "No integration" }, { status: 400 });
        case "quoted_not_found":
          return NextResponse.json({ error: "quoted message not found" }, { status: 400 });
        case "provider_failed":
          return NextResponse.json({ error: "Falha ao enviar pela API do WhatsApp." }, { status: 502 });
        case "not_author":
          return NextResponse.json(
            { error: "Esta mensagem foi enviada por uma integração e só ela pode reenviá-la." },
            { status: 409 }
          );
        default:
          // Os outros desfechos só existem no envio por token (API v1).
          throw new Error(`send: desfecho inesperado (${result.reason})`);
      }
    }

    return NextResponse.json({ message: result.message });
  } catch (err) {
    console.error("[POST /api/chat/conversations/[id]/send]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
