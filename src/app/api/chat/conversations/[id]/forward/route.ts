import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { overridableFrom } from "@/features/chat/lib/delivery-status";
import {
  MAX_FORWARD_TARGETS,
  buildForwardPayload,
  type ForwardPayload,
} from "@/features/chat/lib/message-actions";
import { sendUazapiMedia, sendUazapiText } from "@/features/chat/lib/senders/uazapi";
import type { ChatMessage } from "@/features/chat/types";
import { resolveConversationChannelAddress } from "@/features/chat/lib/conversation-channel-address";
import { getIntegrationCredentials } from "@/features/chat/lib/connection/integration";

// Encaminhar mensagens desta conversa para outras.
//
// **A uazapi não tem endpoint de encaminhar.** Encaminhar é reenviar o conteúdo
// com `forward: true`, que é o que põe a etiqueta "Encaminhada" no WhatsApp. A
// cópia é uma `chat_messages` própria no destino, com `external_id` próprio —
// nada é movido.
//
// As mensagens são carregadas com `conversation_id = [id]`: sem esse filtro, um
// id vindo do cliente encaminharia mensagem de outro paciente.

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

type Target = {
  id: string;
  external_id: string;
  contact_phone: string | null;
  integration_id: string | null;
};

export async function POST(request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  try {
    const { id } = await params;
    const body = (await request.json()) as {
      messageIds?: unknown;
      targetConversationIds?: unknown;
    };

    const messageIds = asIdList(body.messageIds);
    const targetIds = asIdList(body.targetConversationIds);

    if (messageIds.length === 0 || targetIds.length === 0) {
      return NextResponse.json(
        { error: "Selecione ao menos uma mensagem e uma conversa." },
        { status: 400 }
      );
    }
    // Mesmo limite do WhatsApp. Segura disparo em massa e protege a instância.
    if (targetIds.length > MAX_FORWARD_TARGETS) {
      return NextResponse.json(
        { error: `Encaminhe para no máximo ${MAX_FORWARD_TARGETS} conversas.` },
        { status: 400 }
      );
    }
    if (targetIds.includes(id)) {
      return NextResponse.json(
        { error: "Escolha uma conversa diferente da atual." },
        { status: 400 }
      );
    }

    const supabase = createSupabaseAdminClient();

    // Ordem cronológica: encaminhar 3 mensagens tem de reproduzir a sequência
    // original no destino, não a ordem em que o operador foi clicando.
    const { data: rows } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", id)
      .in("id", messageIds)
      .order("created_at", { ascending: true });

    const messages = (rows ?? []) as ChatMessage[];
    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensagens não encontradas." }, { status: 404 });
    }

    const { data: targetRows } = await supabase
      .from("chat_conversations")
      .select("id, external_id, contact_phone, integration_id")
      .in("id", targetIds);
    const targets = (targetRows ?? []) as Target[];
    if (targets.length === 0) {
      return NextResponse.json({ error: "Conversas não encontradas." }, { status: 404 });
    }

    const integrations = await loadIntegrations(supabase, targets);

    let sent = 0;
    let failed = 0;

    for (const target of targets) {
      const credentials = target.integration_id
        ? integrations.get(target.integration_id)
        : undefined;
      const phone = resolveConversationChannelAddress(target);

      if (!credentials || !phone) {
        // Conversa sem telefone ou sem integração uazapi: conta como falha em
        // vez de derrubar as outras.
        failed += messages.length;
        continue;
      }

      for (const message of messages) {
        const payload = buildForwardPayload(message);
        if (!payload) {
          failed += 1;
          continue;
        }
        const ok = await forwardOne({
          supabase,
          target: target.id,
          phone,
          payload,
          credentials,
          viewerId: auth.viewer.id,
        });
        if (ok) sent += 1;
        else failed += 1;
      }
    }

    return NextResponse.json({ sent, failed });
  } catch (err) {
    console.error("[POST /api/chat/conversations/[id]/forward]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

type Credentials = { apiUrl: string; token: string };

/**
 * Envia uma cópia e grava a mensagem no destino.
 *
 * Segue o mesmo roteiro das rotas de envio: insere `pending` (o id vira o
 * `track_id`), envia, grava `external_id` + `sent`; no erro, marca `failed` e
 * devolve false. A falha de um par não pode abortar o lote.
 */
async function forwardOne({
  supabase,
  target,
  phone,
  payload,
  credentials,
  viewerId,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  target: string;
  phone: string;
  payload: ForwardPayload;
  credentials: Credentials;
  viewerId: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const isText = payload.kind === "text";

  const { data: copy, error: insErr } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: target,
      direction: "outbound",
      sender_type: "agent",
      type: isText ? "text" : messageTypeOf(payload),
      // A assinatura do operador NÃO entra: encaminhar reproduz o que foi
      // escrito, e assinar mudaria o texto que o paciente original mandou.
      content: isText ? payload.text : payload.caption ?? null,
      ...(payload.kind === "media" && payload.docName
        ? { metadata: { fileName: payload.docName, forwarded: true } }
        : { metadata: { forwarded: true } }),
      media_url: payload.kind === "media" ? payload.file : null,
      media_mime_type: payload.kind === "media" ? payload.mimeType ?? null : null,
      delivery_status: "pending",
      sent_by_user_id: viewerId,
      created_at: now,
    })
    .select()
    .single();

  if (insErr || !copy) {
    console.error("[forward] insert falhou:", insErr);
    return false;
  }

  try {
    const result = isText
      ? await sendUazapiText(credentials.apiUrl, credentials.token, phone, payload.text, {
          trackId: copy.id,
          forward: true,
        })
      : await sendUazapiMedia(credentials.apiUrl, credentials.token, phone, {
          type: payload.type,
          file: payload.file,
          ...(payload.caption ? { text: payload.caption } : {}),
          ...(payload.docName ? { docName: payload.docName } : {}),
          trackId: copy.id,
          forward: true,
        });

    await supabase
      .from("chat_messages")
      .update({ external_id: result.messageid, delivery_status: "sent" })
      .eq("id", copy.id)
      .in("delivery_status", overridableFrom("sent"));

    return true;
  } catch (err) {
    console.error("[forward] envio falhou:", err);
    await supabase
      .from("chat_messages")
      .update({ delivery_status: "failed" })
      .eq("id", copy.id)
      .in("delivery_status", overridableFrom("failed"));
    return false;
  }
}

/** Credenciais uazapi por integração, sem uma consulta por destino. */
async function loadIntegrations(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  targets: Target[]
): Promise<Map<string, Credentials>> {
  const ids = [...new Set(targets.map((t) => t.integration_id).filter(Boolean))] as string[];
  const map = new Map<string, Credentials>();

  // Uma integração na v1 (unique por provedor): o laço roda uma vez.
  for (const id of ids) {
    const integration = await getIntegrationCredentials(supabase, id);
    if (integration) map.set(id, { apiUrl: integration.apiUrl, token: integration.token });
  }
  return map;
}

/** Tipo da nossa `chat_messages` a partir do tipo de mídia da uazapi. */
function messageTypeOf(payload: ForwardPayload): ChatMessage["type"] {
  if (payload.kind === "text") return "text";
  if (payload.type === "ptt") return "audio";
  if (payload.type === "sticker") return "sticker";
  if (payload.type === "video") return "video";
  if (payload.type === "image") return "image";
  return "document";
}

/** Lista de ids não vazios, sem repetição. */
function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
  return [...new Set(ids)];
}
