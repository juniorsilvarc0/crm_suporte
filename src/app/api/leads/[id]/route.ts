import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http/read-json-body";
import { normalizePhone } from "@/lib/formatters/phone";
import {
  isAmbiguousLeadStatusError,
  setLeadStatusFromSingleDeal,
} from "@/features/leads/queries/set-lead-status";
import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nullableText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().trim().min(1).nullable().optional()
);
const nullableNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().nullable().optional()
);
const nullableBool = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  return v === "true" || v === "on" || v === "sim" || v === 1 || v === "1";
}, z.boolean().nullable().optional());

// Enum vindo de <select>: "" (vazio) vira undefined = "não altera este campo".
const emptyToUndef = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const updateSchema = z.object({
  name: nullableText,
  phone: z.string().trim().min(8).optional(),
  instagram_user: nullableText,
  email: nullableText,
  source: z.preprocess(
    emptyToUndef,
    z
      .enum(["agencia", "anuncio", "particular", "indicacao", "whatsapp", "importado", "outro"])
      .optional()
  ),
  status: z.preprocess(
    emptyToUndef,
    z
      .enum([
        "novo",
        "em_atendimento",
        "qualificado",
        "agendado",
        "compareceu",
        "cliente",
        "recorrente",
        "perdido",
      ])
      .optional()
  ),
  tipo_ensaio: nullableText,
  agencia_nome: nullableText,
  modelo_nome: nullableText,
  interesse: nullableText,
  valor_estimado: nullableNumber,
  is_recorrente: nullableBool,
  memoria_contexto: nullableText,
  notes: nullableText,
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Lead inválido." }, { status: 400 });
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

  const profilePatch: Database["public"]["Tables"]["leads"]["Update"] = {
    ...parsed.data,
  };
  delete profilePatch.status;

  if (typeof parsed.data.phone === "string") {
    const normalizedPhone = normalizePhone(parsed.data.phone);
    if (!/^\d{10,15}$/.test(normalizedPhone)) {
      return NextResponse.json(
        { ok: false, message: "Informe um telefone válido com DDD." },
        { status: 400 }
      );
    }
    profilePatch.normalized_phone = normalizedPhone;
  }

  const supabase = createSupabaseAdminClient();

  if (parsed.data.status) {
    try {
      await setLeadStatusFromSingleDeal(supabase, {
        leadId: id,
        status: parsed.data.status,
        leadPatch: profilePatch,
      });
    } catch (statusError) {
      const code =
        typeof statusError === "object" && statusError !== null && "code" in statusError
          ? statusError.code
          : null;
      return NextResponse.json(
        {
          ok: false,
          message:
            code === "23505"
              ? "Este telefone já pertence a outra pessoa."
              : code === "P0002"
                ? "Lead não encontrado."
                : isAmbiguousLeadStatusError(statusError)
                  ? "Esta pessoa possui mais de uma oportunidade ativa. Mova o card correto no Funil."
                  : "Não foi possível sincronizar a etapa da pessoa com o Funil.",
        },
        {
          status:
            code === "P0002"
              ? 404
              : code === "23505" || isAmbiguousLeadStatusError(statusError)
                ? 409
                : 500,
        }
      );
    }
  } else {
    const { data, error } = await supabase
      .from("leads")
      .update({
        ...profilePatch,
        archived_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      const identityConflict = error.code === "23505";
      return NextResponse.json(
        {
          ok: false,
          message: identityConflict
            ? "Este telefone já pertence a outra pessoa."
            : error.message,
        },
        { status: identityConflict ? 409 : 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ ok: false, message: "Lead não encontrado." }, { status: 404 });
    }
  }

  revalidatePath("/app");
  revalidatePath("/app/leads");
  revalidatePath("/app/funil");
  return NextResponse.json({ ok: true, message: "Lead atualizado." });
}

// A operação cotidiana arquiva a pessoa. Hard delete fica deliberadamente fora
// da API: conversa, funil, agenda e histórico continuam ligados ao mesmo id.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Lead inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, message: "Lead não encontrado." }, { status: 404 });
  }

  revalidatePath("/app");
  revalidatePath("/app/leads");
  revalidatePath("/app/funil");
  return NextResponse.json({ ok: true, archived: true, message: "Pessoa arquivada." });
}
