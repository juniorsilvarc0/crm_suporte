import { NextResponse } from "next/server";

import { reconcileExternalContracts } from "@/features/customers/server/external-contracts";
import type { ReconcileContractsReport } from "@/features/customers/types";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export type SyncContractsResponse =
  | { ok: true; report: ReconcileContractsReport }
  | { ok: false; message: string };

// Reconciliação do espelho de contratos da TCBX para TODAS as empresas com CNPJ
// (admin). Uma leva por chamada (idempotente): a tela repete por cursor até
// `done`. É escrita (cria linhas em external_contracts): POST, nunca GET.
export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      {
        ok: false,
        message: "Supabase admin não está configurado neste ambiente.",
      } satisfies SyncContractsResponse,
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  const input =
    body.error || typeof body.data !== "object" || body.data === null
      ? {}
      : (body.data as Record<string, unknown>);
  const limit = typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : undefined;
  const after = typeof input.after === "string" && input.after.length > 0 ? input.after : null;

  try {
    const report = await reconcileExternalContracts(createSupabaseAdminClient(), { limit, after });
    return NextResponse.json({ ok: true, report } satisfies SyncContractsResponse);
  } catch (error) {
    console.error("[POST /api/customers/sync-contracts]", error);
    return NextResponse.json(
      { ok: false, message: "Não foi possível sincronizar os contratos." } satisfies SyncContractsResponse,
      { status: 500 }
    );
  }
}
