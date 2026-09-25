import { NextResponse } from "next/server";
import { z } from "zod";

import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { checkUazapiNumber } from "@/features/chat/lib/senders/uazapi";
import { resolveContactIdentity } from "@/features/contacts/queries/resolve-contact-identity";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const startConversationSchema = z.object({
  phone: z.string().trim().min(8).max(40),
  name: z.string().trim().min(1).max(160).optional(),
});

export async function POST(request: Request) {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    return NextResponse.json(
      { exists: false, message: "Sessão inválida." },
      { status: 401 }
    );
  }

  const payload = await request.json().catch(() => null);
  const parsed = startConversationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { exists: false, message: "Informe um telefone válido." },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const integration = await getUazapiIntegration(supabase);
    if (!integration) {
      return NextResponse.json(
        { exists: false, message: "A conexão com o WhatsApp não está ativa." },
        { status: 409 }
      );
    }

    const checked = await checkUazapiNumber(
      integration.apiUrl,
      integration.token,
      parsed.data.phone
    );
    if (!checked.exists) {
      return NextResponse.json(
        {
          exists: false,
          phone: checked.phone,
          message: "Este número não está disponível no WhatsApp.",
        },
        { status: 404 }
      );
    }

    const contactName = checked.verifiedName ?? parsed.data.name ?? null;
    const identity = await resolveContactIdentity(supabase, {
      phone: checked.phone,
      name: contactName,
      source: "whatsapp",
    });

    const { data: existing, error: existingError } = await supabase
      .from("chat_conversations")
      .select("*")
      .eq("integration_id", integration.id)
      .eq("external_id", checked.phone)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      const { data: restored, error: restoreError } = await supabase
        .from("chat_conversations")
        .update({
          contact_id: identity.contactId,
          removed_at: null,
          archived_at: null,
          ...(contactName && !existing.contact_name ? { contact_name: contactName } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (restoreError) throw restoreError;
      return NextResponse.json({ exists: true, conversation: restored });
    }

    const { data: conversation, error: insertError } = await supabase
      .from("chat_conversations")
      .insert({
        integration_id: integration.id,
        contact_id: identity.contactId,
        external_id: checked.phone,
        contact_phone: checked.phone,
        ...(contactName ? { contact_name: contactName } : {}),
        // A conversa foi iniciada deliberadamente por um operador.
        status: "human",
        unread_count: 0,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insertError || !conversation) {
      throw insertError ?? new Error("Conversation insert failed");
    }

    return NextResponse.json({ exists: true, conversation });
  } catch (error) {
    console.error("[POST /api/chat/conversations/start]", error);
    return NextResponse.json(
      { exists: false, message: "Não foi possível verificar este telefone." },
      { status: 502 }
    );
  }
}
