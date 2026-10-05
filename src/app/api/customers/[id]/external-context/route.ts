import { NextResponse } from "next/server";

import { getCustomerContext } from "@/features/customer-source/get-customer-context";
import type { CustomerContextResult } from "@/features/customer-source/types";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExternalContextResponse =
  | { ok: true; result: CustomerContextResult }
  | { ok: false; message: string };

// Contexto do cliente na fonte externa (TCBX), para o painel do contato no chat.
// Só leitura: chaveia pela empresa (lê o CNPJ no servidor) e consulta sob
// demanda. Quem atende (member) pode ver. A consulta à fonte mora em
// `customer-source` (outro arquivo), então este GET não dispara RPC direto.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, message: "Empresa inválida." } satisfies ExternalContextResponse,
      { status: 400 }
    );
  }

  // Sem banco não dá para ler o CNPJ: a fonte fica indisponível, não "sem dados".
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, result: { state: "unavailable" } } satisfies ExternalContextResponse);
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("customers").select("cnpj").eq("id", id).maybeSingle();
  if (error) {
    console.error("external-context: leitura da empresa", error.code, error.message);
    return NextResponse.json({ ok: true, result: { state: "unavailable" } } satisfies ExternalContextResponse);
  }
  // Empresa sem CNPJ não tem chave de consulta (o painel só chama quando há CNPJ).
  if (!data?.cnpj) {
    return NextResponse.json({ ok: true, result: { state: "not_found" } } satisfies ExternalContextResponse);
  }

  const result = await getCustomerContext({ documento: data.cnpj });
  return NextResponse.json({ ok: true, result } satisfies ExternalContextResponse);
}
