import { NextResponse } from "next/server";

import { getCustomerContext } from "@/features/customer-source/get-customer-context";
import { resolveCustomerByPhone } from "@/features/customer-source/resolve-by-phone";
import type { CustomerContextResult } from "@/features/customer-source/types";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExternalContextResponse =
  | { ok: true; result: CustomerContextResult }
  | { ok: false; message: string };

// Função (não objeto): um NextResponse só pode ter o corpo lido uma vez, então
// cada requisição precisa do seu.
const unavailable = () =>
  NextResponse.json({ ok: true, result: { state: "unavailable" } } satisfies ExternalContextResponse);

// Contexto do cliente na fonte externa (TCBX), para o painel do contato no chat.
// Chaveia pelo CONTATO da conversa: prefere o CNPJ da empresa vinculada (mais
// preciso) e, sem ela, o TELEFONE do contato (a TCBX passou a aceitar telefone,
// normalizando o +55). Assim o contexto aparece em qualquer conversa, não só nas
// com empresa. Só leitura; a consulta à fonte mora em `customer-source`.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Contato inválido." } satisfies ExternalContextResponse, {
      status: 400,
    });
  }

  if (!hasSupabaseAdminEnv()) return unavailable();

  const supabase = createSupabaseAdminClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .select("phone, customer_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("external-context (contato): leitura do contato", error.code, error.message);
    return unavailable();
  }
  if (!contact) {
    return NextResponse.json({ ok: true, result: { state: "not_found" } } satisfies ExternalContextResponse);
  }

  let documento: string | null = null;
  if (contact.customer_id) {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("cnpj")
      .eq("id", contact.customer_id)
      .maybeSingle();
    if (customerError) {
      console.error("external-context (contato): leitura da empresa", customerError.code, customerError.message);
      return unavailable();
    }
    documento = customer?.cnpj ?? null;
  }

  // Empresa com CNPJ: consulta direta (mais preciso). Senão, pelo telefone do
  // contato, tentando as variações canônicas do número (DDD + 8 últimos).
  const result: CustomerContextResult = documento
    ? await getCustomerContext({ documento })
    : contact.phone
      ? await resolveCustomerByPhone(contact.phone)
      : { state: "not_found" };

  return NextResponse.json({ ok: true, result } satisfies ExternalContextResponse);
}
