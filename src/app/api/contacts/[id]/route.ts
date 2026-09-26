import { NextResponse } from "next/server";
import { z } from "zod";

import { mapCadastroError } from "@/features/customers/lib/map-cadastro-error";
import { readJsonBody } from "@/lib/http/read-json-body";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nullableText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().trim().min(1).nullable().optional()
);

// Só as colunas que o banco deixa o app editar (grant de UPDATE em _contatos).
// `customer_id`: uuid liga à empresa, `null` desliga, ausente não mexe. Empresa
// arquivada ou inexistente quem recusa é o banco (trigger e FK de _cadastros).
const updateSchema = z.object({
  name: nullableText,
  email: nullableText,
  notes: nullableText,
  customer_id: z.string().regex(UUID_RE, "Empresa inválida.").nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Contato inválido." }, { status: 400 });
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

  // Telefone é imutável: o histórico (conversas, tickets) é da pessoa DESTE
  // número. Recusar explicitamente, em vez de descartar o campo em silêncio,
  // evita que a tela pense que trocou o número.
  if (body.data && typeof body.data === "object" && "phone" in body.data) {
    return NextResponse.json(
      {
        ok: false,
        message: "O telefone de um contato não pode ser alterado.",
        errors: { phone: ["O telefone de um contato não pode ser alterado."] },
      },
      { status: 422 }
    );
  }

  const parsed = updateSchema.safeParse(body.data);
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
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ ok: false, message: "Nada para atualizar." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("contacts")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    // Vínculo recusado pelo banco é erro do campo, não falha: a tela mostra
    // "Empresa arquivada" ou "Empresa não encontrada" junto do seletor.
    const mapped = mapCadastroError(error);
    if (mapped.status === 422 && mapped.field === "customer_id") {
      return NextResponse.json(
        { ok: false, message: mapped.message, errors: { customer_id: [mapped.message] } },
        { status: 422 }
      );
    }
    console.error("[PATCH /api/contacts/[id]]", error.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível atualizar o contato." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Contato não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: "Contato atualizado." });
}

// A operação cotidiana arquiva a pessoa. Hard delete fica deliberadamente fora
// da API: conversas e histórico continuam ligados ao mesmo id.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Contato inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("contacts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[DELETE /api/contacts/[id]]", error.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível arquivar o contato." },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json({ ok: false, message: "Contato não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, archived: true, message: "Contato arquivado." });
}
