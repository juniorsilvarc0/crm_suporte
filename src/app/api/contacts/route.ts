import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizePhone } from "@/lib/formatters/phone";
import {
  resolveContactIdentity,
  type ContactIdentityResolution,
} from "@/features/contacts/queries/resolve-contact-identity";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

// `api` fica de fora: é a origem de quem cadastra pela API de integração.
const createContactSchema = z.object({
  name: optionalText,
  phone: z.string().trim().min(8, "Informe um telefone com DDD."),
  source: z.enum(["whatsapp", "indicacao", "manual"]).default("manual"),
});

/**
 * Cadastro de contato pela tela. Contato só nasce pelo resolvedor de
 * identidade: mesmo número = mesma pessoa, então repetir o cadastro devolve o
 * contato que já existe (e o reativa, se estava arquivado).
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

  const parsed = createContactSchema.safeParse(body.data);

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

  if (!/^\d{10,15}$/.test(normalizePhone(parsed.data.phone))) {
    return NextResponse.json(
      {
        ok: false,
        message: "Informe um telefone com DDD.",
        errors: { phone: ["Informe um telefone com DDD."] },
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();

  let identity: ContactIdentityResolution;
  try {
    identity = await resolveContactIdentity(supabase, {
      phone: parsed.data.phone,
      name: parsed.data.name,
      source: parsed.data.source,
    });
  } catch (identityError) {
    const code =
      typeof identityError === "object" && identityError !== null && "code" in identityError
        ? identityError.code
        : null;
    if (code !== "23505") console.error("[POST /api/contacts]", identityError);
    return NextResponse.json(
      {
        ok: false,
        message:
          code === "23505"
            ? "Este telefone já pertence a outra pessoa."
            : "Não foi possível salvar o contato.",
      },
      { status: code === "23505" ? 409 : 500 }
    );
  }

  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, name, phone, normalized_phone")
    .eq("id", identity.contactId)
    .single();

  if (error || !contact) {
    console.error("[POST /api/contacts]", error?.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível ler o contato salvo." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    created: identity.created,
    message: identity.created ? "Contato salvo." : "Este contato já existia.",
    contact,
  });
}
