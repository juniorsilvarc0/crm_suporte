import { NextResponse } from "next/server";

import { mapCadastroError } from "@/features/customers/lib/map-cadastro-error";
import { searchCustomerOptions } from "@/features/customers/queries/get-customers-page";
import { customerCreateSchema } from "@/features/customers/schemas/customer";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Opções do seletor de empresa: só ATIVAS, com as colunas do CustomerSummary
 * (nada de contrato além do selo). `limit` fora de 1..20 é ajustado pela query.
 *
 * Erro de banco responde 500, nunca lista vazia: vazio seria lido como
 * "nenhuma empresa encontrada".
 */
export async function GET(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);

  try {
    const items = await searchCustomerOptions(createSupabaseAdminClient(), { q, limit });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("[GET /api/customers]", error);
    return NextResponse.json(
      { ok: false, message: "Não foi possível buscar as empresas." },
      { status: 500 }
    );
  }
}

/**
 * Cadastro de empresa (member ou admin). O CNPJ chega normalizado pelo schema;
 * o banco garante que ele é único entre as ATIVAS. Em conflito, a resposta
 * aponta a empresa que já tem o CNPJ, para a tela oferecer abrir a ficha dela
 * em vez de cadastrar de novo.
 */
export async function POST(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = customerCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      legal_name: parsed.data.legal_name,
      trade_name: parsed.data.trade_name ?? null,
      cnpj: parsed.data.cnpj ?? null,
      notes: parsed.data.notes ?? null,
      created_by_user_id: auth.viewer.id,
    })
    .select("id")
    .single();

  if (error) {
    const mapped = mapCadastroError(error);
    const errors = mapped.field ? { [mapped.field]: [mapped.message] } : undefined;

    // customers_cnpj_active_uidx: 2ª leitura para devolver QUAL empresa ativa
    // já tem o CNPJ. Se ela falhar (ou a outra foi arquivada no meio), o 409
    // sai sem `existing` — o conflito continua verdadeiro.
    if (mapped.status === 409 && mapped.field === "cnpj" && parsed.data.cnpj) {
      const { data: existing, error: existingError } = await supabase
        .from("customers")
        .select("id")
        .eq("cnpj", parsed.data.cnpj)
        .is("archived_at", null)
        .maybeSingle();
      if (existingError) console.error("[POST /api/customers] existing", existingError.message);

      return NextResponse.json(
        {
          ok: false,
          message: mapped.message,
          errors,
          existing: existing ? { id: existing.id } : undefined,
        },
        { status: 409 }
      );
    }

    if (mapped.status >= 500) console.error("[POST /api/customers]", error.message);
    return NextResponse.json(
      { ok: false, message: mapped.message, errors },
      { status: mapped.status }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Empresa cadastrada.",
    customer: { id: data.id },
  });
}
