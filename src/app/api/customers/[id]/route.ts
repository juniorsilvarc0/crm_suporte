import { NextResponse } from "next/server";
import type { ZodError } from "zod";

import { cadastroErrorResponse } from "@/features/customers/lib/cadastro-error-response";
import { mapCadastroError } from "@/features/customers/lib/map-cadastro-error";
import { customerUpdateSchema } from "@/features/customers/schemas/customer";
import {
  requireDashboardAdmin,
  requireDashboardUser,
} from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edição da empresa (member ou admin). Grava só as chaves enviadas — o
 * formulário manda os campos alterados, e ausente não apaga nada. Empresa
 * arquivada não é editada: reativar é ação de admin, com rota própria.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Empresa inválida." }, { status: 400 });
  }

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

  const parsed = customerUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: rootErrorMessage(parsed.error) ?? "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customers")
    .update(parsed.data)
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return cadastroErrorResponse("[PATCH /api/customers/[id]]", error);
  }

  if (!data) {
    // Nenhuma linha ativa com este id: 2ª leitura separa "não existe" de
    // "arquivada", para a tela dizer o que fazer.
    const { data: current, error: readError } = await supabase
      .from("customers")
      .select("id, archived_at")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      console.error("[PATCH /api/customers/[id]]", readError.message);
      return NextResponse.json(
        { ok: false, message: "Não foi possível atualizar a empresa." },
        { status: 500 }
      );
    }
    if (!current) {
      return NextResponse.json({ ok: false, message: "Empresa não encontrada." }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, message: "Empresa arquivada. Reative-a antes de editar." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, message: "Empresa atualizada." });
}

/**
 * Arquivar é de admin. Não apaga: contatos ligados continuam ligados (histórico)
 * e o CNPJ fica livre para outra empresa ativa. O banco recusa arquivar com
 * contrato vigente (trigger guard_customer_archive → CUSTOMER_HAS_CURRENT_CONTRACT).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Empresa inválida." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    const mapped = mapCadastroError(error);
    if (mapped.status >= 500) console.error("[DELETE /api/customers/[id]]", error.message);
    return NextResponse.json({ ok: false, message: mapped.message }, { status: mapped.status });
  }

  if (!data) {
    // O filtro `archived_at is null` mantém a data do primeiro arquivamento;
    // aqui só resta saber se a empresa existe.
    const { data: current, error: readError } = await supabase
      .from("customers")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      console.error("[DELETE /api/customers/[id]]", readError.message);
      return NextResponse.json(
        { ok: false, message: "Não foi possível arquivar a empresa." },
        { status: 500 }
      );
    }
    if (!current) {
      return NextResponse.json({ ok: false, message: "Empresa não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, archived: true, message: "Empresa já estava arquivada." });
  }

  return NextResponse.json({ ok: true, archived: true, message: "Empresa arquivada." });
}

/**
 * Erro de raiz não entra em `fieldErrors`: sem isto a tela receberia "Revise os
 * campos destacados." sem nenhum campo destacado. Cobre o corpo sem nada para
 * gravar (refine do schema) e a chave recusada pelo `.strict()` (ex.:
 * archived_at, que tem rota própria).
 */
function rootErrorMessage(error: ZodError): string | null {
  const root = error.issues.find((issue) => issue.path.length === 0);
  if (root?.code === "custom") return root.message;
  if (root?.code === "unrecognized_keys") {
    return `Campo que não pode ser alterado por aqui: ${root.keys.join(", ")}.`;
  }
  return null;
}
