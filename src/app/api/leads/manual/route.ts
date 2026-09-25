import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizePhone } from "@/lib/formatters/phone";
import { resolveLeadIdentity } from "@/features/leads/queries/resolve-lead-identity";
import {
  isAmbiguousLeadStatusError,
  setLeadStatusFromSingleDeal,
} from "@/features/leads/queries/set-lead-status";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const leadSourceValues = [
  "agencia",
  "anuncio",
  "particular",
  "indicacao",
  "whatsapp",
  "importado",
  "outro",
] as const;

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const manualLeadSchema = z.object({
  name: optionalText,
  phone: z.string().trim().min(8, "Informe um telefone com DDD."),
  instagram_user: optionalText,
  email: optionalText,
  source: z.enum(leadSourceValues).default("whatsapp"),
  status: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/)
    .default("novo"),
  tipo_ensaio: optionalText,
  agencia_nome: optionalText,
  modelo_nome: optionalText,
  notes: optionalText,
});

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

  const parsed = manualLeadSchema.safeParse(body.data);

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

  const normalizedPhone = normalizePhone(parsed.data.phone);

  if (!/^\d{10,15}$/.test(normalizedPhone)) {
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
  const now = new Date().toISOString();
  const identity = await resolveLeadIdentity(supabase, {
    phone: parsed.data.phone,
    name: parsed.data.name,
    source: parsed.data.source,
    createInitialDeal: true,
    lastInteractionAt: now,
  });

  try {
    await setLeadStatusFromSingleDeal(supabase, {
      leadId: identity.leadId,
      status: parsed.data.status,
      occurredAt: now,
      leadPatch: {
        phone: parsed.data.phone,
        normalized_phone: normalizedPhone,
        name: parsed.data.name,
        instagram_user: parsed.data.instagram_user,
        email: parsed.data.email,
        source: parsed.data.source,
        tipo_ensaio: parsed.data.tipo_ensaio,
        agencia_nome: parsed.data.agencia_nome,
        modelo_nome: parsed.data.modelo_nome,
        notes: parsed.data.notes,
        imported: false,
        last_message_at: now,
      },
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
            : isAmbiguousLeadStatusError(statusError)
              ? "Esta pessoa possui mais de uma oportunidade ativa. Escolha o card no Funil."
              : "Não foi possível sincronizar a etapa da pessoa com o Funil.",
      },
      { status: code === "23505" || isAmbiguousLeadStatusError(statusError) ? 409 : 500 }
    );
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, name, phone, normalized_phone")
    .eq("id", identity.leadId)
    .single();

  if (error || !lead) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Lead não encontrado." },
      { status: 500 }
    );
  }

  revalidatePath("/app");
  revalidatePath("/app/leads");
  revalidatePath("/app/funil");

  return NextResponse.json({ ok: true, message: "Lead salvo.", lead });
}
