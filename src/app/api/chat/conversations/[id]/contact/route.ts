import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/formatters/phone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContactInfo } from "@/features/chat/lib/contact-info";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Agendamento cancelado não é "o próximo": ele não vai acontecer. */
const LIVE_APPOINTMENT_STATUS = ["agendado", "confirmado"] as const;

const EMPTY: ContactInfo = { lead: null, nextAppointment: null };

/**
 * Lead e próximo agendamento da pessoa do outro lado da conversa.
 *
 * Precisa ser no servidor: a RLS fecha `leads` e `appointments` para `anon`, e
 * ampliar essa superfície para pintar uma tela seria decisão de segurança, não
 * de interface (AGENTS §3.1).
 *
 * A FK `chat_conversations.lead_id` é a fonte normal. O fallback por telefone
 * existe apenas para a janela de rollout anterior à migration.
 *
 * Erro devolve vazio e loga, como `getDeals` e `getLeadAttributions`: a tela de
 * contato ainda mostra nome, foto e telefone sem o lead — derrubá-la inteira por
 * causa do bloco de CRM seria pior que exibi-la incompleta.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = createSupabaseAdminClient();

    const { data: conversation, error: conversationError } = await supabase
      .from("chat_conversations")
      .select("lead_id, contact_phone")
      .eq("id", id)
      .maybeSingle();

    if (conversationError) {
      console.error("[GET /api/chat/conversations/[id]/contact]", conversationError.message);
      return NextResponse.json(EMPTY);
    }

    let leadQuery = supabase
      .from("leads")
      .select("id, status, source, email, notes, valor_estimado, created_at");

    if (conversation?.lead_id) {
      leadQuery = leadQuery.eq("id", conversation.lead_id);
    } else {
      const normalized = normalizePhone(conversation?.contact_phone ?? "");
      if (normalized.length < 10) return NextResponse.json(EMPTY);
      leadQuery = leadQuery.eq("normalized_phone", normalized);
    }

    const { data: lead, error: leadError } = await leadQuery.maybeSingle();

    if (leadError) {
      console.error("[GET /api/chat/conversations/[id]/contact]", leadError.message);
      return NextResponse.json(EMPTY);
    }
    if (!lead) return NextResponse.json(EMPTY);

    const { data: appointment, error: appointmentError } = await supabase
      .from("appointments")
      .select("id, scheduled_at, status, tipo_ensaio")
      .eq("lead_id", lead.id)
      .in("status", LIVE_APPOINTMENT_STATUS)
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (appointmentError) {
      console.error("[GET /api/chat/conversations/[id]/contact]", appointmentError.message);
    }

    const info: ContactInfo = {
      lead,
      nextAppointment: appointmentError ? null : (appointment ?? null),
    };
    return NextResponse.json(info);
  } catch (err) {
    console.error("[GET /api/chat/conversations/[id]/contact] threw", err);
    return NextResponse.json(EMPTY);
  }
}
