import { NextResponse } from "next/server";

import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { ContactInfo } from "@/features/chat/lib/contact-info";
import { toCustomerSummary } from "@/features/customers/lib/customer-display";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Colunas explícitas nos dois níveis: a empresa sai com as do CustomerSummary,
// e nada daqui encosta em support_contracts — o selo já está em
// customers.contract_status.
const CONTACT_INFO_SELECT =
  "contact:contacts(id, email, notes, created_at, customer:customers(id, legal_name, trade_name, cnpj, contract_status, archived_at))";

const FAILURE_MESSAGE = "Não foi possível carregar os dados do contato.";

/**
 * Cadastro da pessoa do outro lado da conversa, com a empresa dela.
 *
 * Precisa ser no servidor: `contacts` e `customers` não têm grant para
 * `authenticated`, e ampliar essa superfície para pintar uma tela seria decisão
 * de segurança, não de interface (AGENTS §3.1).
 *
 * `chat_conversations.contact_id` é NOT NULL e é a única FK entre as duas
 * tabelas, então o embed resolve contato e empresa numa ida só.
 *
 * Erro de banco responde 500, e não vazio: com a empresa no payload, um vazio
 * viraria um falso "Sem empresa vinculada". O hook trata `!ok` como falha e a
 * tela oferece "Tentar de novo".
 */
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Conversa inválida." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();

    const { data: conversation, error } = await supabase
      .from("chat_conversations")
      .select(CONTACT_INFO_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/chat/conversations/[id]/contact]", error.message);
      return NextResponse.json({ ok: false, message: FAILURE_MESSAGE }, { status: 500 });
    }

    // Campo a campo, nunca com spread: coluna a mais que o embed traga não
    // chega ao navegador. Conversa inexistente = os dois `null`.
    const contact = conversation?.contact ?? null;
    const info: ContactInfo = {
      contact: contact
        ? {
            id: contact.id,
            email: contact.email,
            notes: contact.notes,
            created_at: contact.created_at,
          }
        : null,
      customer: contact?.customer ? toCustomerSummary(contact.customer) : null,
    };
    return NextResponse.json(info);
  } catch (err) {
    console.error("[GET /api/chat/conversations/[id]/contact] threw", err);
    return NextResponse.json({ ok: false, message: FAILURE_MESSAGE }, { status: 500 });
  }
}
