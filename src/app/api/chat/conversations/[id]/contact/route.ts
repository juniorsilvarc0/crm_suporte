import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContactInfo } from "@/features/chat/lib/contact-info";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const EMPTY: ContactInfo = { contact: null };

/**
 * Cadastro da pessoa do outro lado da conversa.
 *
 * Precisa ser no servidor: `contacts` não tem grant para `authenticated`, e
 * ampliar essa superfície para pintar uma tela seria decisão de segurança, não
 * de interface (AGENTS §3.1).
 *
 * `chat_conversations.contact_id` é NOT NULL e é a única FK entre as duas
 * tabelas, então o embed resolve o contato numa ida só.
 *
 * Erro devolve vazio e loga, como `getNotes` e `getAppUsers`: a tela de
 * contato ainda mostra nome, foto e telefone sem o cadastro — derrubá-la
 * inteira por causa do bloco de CRM seria pior que exibi-la incompleta.
 */
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  try {
    const { id } = await params;
    const supabase = createSupabaseAdminClient();

    const { data: conversation, error } = await supabase
      .from("chat_conversations")
      .select("contact:contacts(id, email, notes, created_at)")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/chat/conversations/[id]/contact]", error.message);
      return NextResponse.json(EMPTY);
    }
    if (!conversation?.contact) return NextResponse.json(EMPTY);

    const info: ContactInfo = { contact: conversation.contact };
    return NextResponse.json(info);
  } catch (err) {
    console.error("[GET /api/chat/conversations/[id]/contact] threw", err);
    return NextResponse.json(EMPTY);
  }
}
