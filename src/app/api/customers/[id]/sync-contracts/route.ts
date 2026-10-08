import { NextResponse } from "next/server";

import {
  syncExternalContracts,
  type SyncContractsResult,
} from "@/features/customers/server/external-contracts";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SyncCustomerContractsResponse =
  | { ok: true; result: SyncContractsResult }
  | { ok: false; message: string };

// Sincroniza o espelho de contratos da TCBX de UMA empresa (admin): o botão
// "Atualizar da TCBX" da ficha. Lê o CNPJ no servidor e consulta a fonte. É
// escrita: POST, nunca GET.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, message: "Empresa inválida." } satisfies SyncCustomerContractsResponse,
      { status: 400 }
    );
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      {
        ok: false,
        message: "Supabase admin não está configurado neste ambiente.",
      } satisfies SyncCustomerContractsResponse,
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("customers").select("cnpj").eq("id", id).maybeSingle();
  if (error) {
    console.error("[POST /api/customers/[id]/sync-contracts] customer", error.code, error.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível ler a empresa." } satisfies SyncCustomerContractsResponse,
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, message: "Empresa não encontrada." } satisfies SyncCustomerContractsResponse,
      { status: 404 }
    );
  }

  try {
    const result = await syncExternalContracts(supabase, { customerId: id, cnpj: data.cnpj });
    return NextResponse.json({ ok: true, result } satisfies SyncCustomerContractsResponse);
  } catch (err) {
    console.error("[POST /api/customers/[id]/sync-contracts]", err);
    return NextResponse.json(
      { ok: false, message: "Não foi possível sincronizar os contratos." } satisfies SyncCustomerContractsResponse,
      { status: 500 }
    );
  }
}
