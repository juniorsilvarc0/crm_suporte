import { NextResponse } from "next/server";

import { backfillExternalCustomers, type BackfillReport } from "@/features/customers/server/backfill-external";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export type BackfillResponse =
  | { ok: true; apply: boolean; report: BackfillReport }
  | { ok: false; message: string };

// Cadastro em massa de empresas a partir da TCBX (admin). Uma leva por chamada
// (idempotente): a tela repete até `remaining` chegar a zero. `apply: false` é o
// ensaio (não grava). É escrita: POST, nunca GET.
export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." } satisfies BackfillResponse,
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  const input = body.error || typeof body.data !== "object" || body.data === null ? {} : (body.data as Record<string, unknown>);
  const apply = input.apply === true;
  const limit = typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : undefined;
  const after = typeof input.after === "string" && input.after.length > 0 ? input.after : null;

  try {
    const report = await backfillExternalCustomers(createSupabaseAdminClient(), {
      apply,
      limit,
      after,
      createdBy: auth.viewer.id,
    });
    return NextResponse.json({ ok: true, apply, report } satisfies BackfillResponse);
  } catch (error) {
    console.error("[POST /api/customers/backfill-external]", error);
    return NextResponse.json(
      { ok: false, message: "Não foi possível executar o cadastro em massa." } satisfies BackfillResponse,
      { status: 500 }
    );
  }
}
