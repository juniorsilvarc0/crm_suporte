import { revalidatePath } from "next/cache";
import { syncDealsOnAttendance } from "@/features/deals/queries/sync-attendance";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http/read-json-body";
import { localDateTimeToIso } from "@/lib/formatters/date";
import { normalizePhone } from "@/lib/formatters/phone";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { resolveLeadIdentity } from "@/features/leads/queries/resolve-lead-identity";
import {
  isAmbiguousLeadStatusError,
  setLeadStatusFromSingleDeal,
} from "@/features/leads/queries/set-lead-status";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database, LeadStatus } from "@/lib/supabase/types";

export const runtime = "nodejs";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const leadSourceValues = [
  "agencia",
  "anuncio",
  "particular",
  "indicacao",
  "whatsapp",
  "importado",
  "outro",
] as const;

const createAppointmentSchema = z
  .object({
    client_mode: z.enum(["existing", "new"]).default("existing"),
    lead_id: optionalText,
    new_client_name: optionalText,
    new_client_phone: optionalText,
    new_client_email: optionalText,
    new_client_instagram_user: optionalText,
    new_client_source: z.enum(leadSourceValues).default("whatsapp"),
    scheduled_at: z
      .string()
      .min(1, "Informe data e hora.")
      .refine((value) => localDateTimeToIso(value) !== "", "Data inválida."),
    tipo_ensaio: optionalText,
    duration_min: z.coerce.number().int().positive().default(60),
    notes: optionalText,
    // Onde e como o atendimento acontece. Ambos opcionais: agendamento antigo
    // e importação do Google não têm essa informação, e exigi-la agora
    // inviabilizaria integração que já funciona.
    modality: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.enum(["presencial", "teleconsulta"]).optional()
    ),
    unit_id: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.uuid().optional()
    ),
    status: z
      .enum(["agendado", "confirmado", "compareceu", "faltou", "cancelado"])
      .default("agendado"),
    // Quem fez o agendamento (opcional). Vem do select "Agendado por"; se ausente,
    // a rota carimba o usuário logado. String vazia → undefined → cai no fallback.
    created_by_user_id: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().uuid().optional()
    ),
  })
  .superRefine((value, ctx) => {
    if (value.client_mode === "existing") {
      const leadId = value.lead_id ?? "";
      const valid = z.string().uuid().safeParse(leadId).success;
      if (!valid) {
        ctx.addIssue({
          code: "custom",
          path: ["lead_id"],
          message: "Selecione um cliente válido.",
        });
      }
      return;
    }

    if (!value.new_client_name) {
      ctx.addIssue({
        code: "custom",
        path: ["new_client_name"],
        message: "Informe o nome do cliente.",
      });
    }

    const phone = normalizePhone(value.new_client_phone ?? "");
    if (!/^\d{10,15}$/.test(phone)) {
      ctx.addIssue({
        code: "custom",
        path: ["new_client_phone"],
        message: "Informe um telefone com DDD.",
      });
    }
  });

type LeadStatusUpdate = {
  status: LeadStatus;
  agendado_at?: string;
  compareceu_at?: string;
};

function deriveLeadUpdate(
  appointmentStatus: string,
  scheduledAtIso: string,
  nowIso: string
): LeadStatusUpdate | null {
  if (appointmentStatus === "compareceu") {
    return { status: "compareceu", agendado_at: scheduledAtIso, compareceu_at: nowIso };
  }
  if (appointmentStatus === "agendado" || appointmentStatus === "confirmado") {
    return { status: "agendado", agendado_at: scheduledAtIso };
  }
  return null;
}

export async function POST(request: Request) {
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

  const parsed = createAppointmentSchema.safeParse(body.data);
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
  const scheduledAtIso = localDateTimeToIso(parsed.data.scheduled_at);
  const nowIso = new Date().toISOString();
  const leadUpdate = deriveLeadUpdate(parsed.data.status, scheduledAtIso, nowIso);
  let leadId = parsed.data.lead_id;
  let newClientProfilePatch:
    | Database["public"]["Tables"]["leads"]["Update"]
    | undefined;

  // Autoria: o valor enviado pelo formulário tem prioridade; se não veio, carimba
  // quem está logado. Fica null (= "IA / não atribuído") se nenhum dos dois existir.
  const createdByUserId =
    parsed.data.created_by_user_id ?? (await getDashboardViewer())?.id ?? null;

  if (parsed.data.client_mode === "new") {
    const normalizedPhone = normalizePhone(parsed.data.new_client_phone ?? "");
    const identity = await resolveLeadIdentity(supabase, {
      phone: parsed.data.new_client_phone ?? "",
      name: parsed.data.new_client_name,
      source: parsed.data.new_client_source,
      createInitialDeal: true,
      lastInteractionAt: nowIso,
    });

    const profilePatch: Database["public"]["Tables"]["leads"]["Update"] = {
      name: parsed.data.new_client_name,
      phone: parsed.data.new_client_phone,
      normalized_phone: normalizedPhone,
      email: parsed.data.new_client_email,
      instagram_user: parsed.data.new_client_instagram_user,
      source: parsed.data.new_client_source,
      tipo_ensaio: parsed.data.tipo_ensaio,
      notes: parsed.data.notes,
      last_message_at: nowIso,
      ...(leadUpdate?.agendado_at ? { agendado_at: leadUpdate.agendado_at } : {}),
    };

    newClientProfilePatch = profilePatch;
    leadId = identity.leadId;
  }

  const { data: created, error } = await supabase
    .from("appointments")
    .insert({
      lead_id: leadId,
      scheduled_at: scheduledAtIso,
      tipo_ensaio: parsed.data.tipo_ensaio,
      duration_min: parsed.data.duration_min,
      notes: parsed.data.notes,
      status: parsed.data.status,
      modality: parsed.data.modality ?? null,
      unit_id: parsed.data.unit_id ?? null,
      created_by_user_id: createdByUserId,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  let completionMessage = "Agendamento criado.";
  let statusSynced = true;

  // O agendamento é a ação principal e já está persistido. Sincronizar depois
  // evita mudar a pessoa/o card se a inserção falhar e, em caso de etapa
  // ambígua, evita devolver erro que levaria o operador a reenviar e duplicar.
  if (leadUpdate && leadId) {
    try {
      await setLeadStatusFromSingleDeal(supabase, {
        leadId,
        status: leadUpdate.status,
        occurredAt: leadUpdate.status === "agendado" ? scheduledAtIso : nowIso,
        leadPatch:
          newClientProfilePatch ??
          (leadUpdate.agendado_at ? { agendado_at: leadUpdate.agendado_at } : undefined),
      });
    } catch (statusError) {
      statusSynced = false;
      completionMessage = isAmbiguousLeadStatusError(statusError)
        ? "Agendamento criado. Há mais de uma oportunidade ativa; mova o card correto no Funil."
        : "Agendamento criado, mas não foi possível sincronizar a etapa no Funil.";
      if (!isAmbiguousLeadStatusError(statusError)) {
        console.error("[POST /api/appointments] sincronização do lead:", statusError);
      }
    }
  } else if (newClientProfilePatch && leadId) {
    const { error: leadError } = await supabase
      .from("leads")
      .update({ ...newClientProfilePatch, archived_at: null })
      .eq("id", leadId);
    if (leadError) {
      completionMessage =
        "Agendamento criado, mas não foi possível completar o cadastro da pessoa.";
      console.error("[POST /api/appointments] atualização do lead:", leadError.message);
    }
  }

  if (leadUpdate?.status === "compareceu" && leadId && statusSynced) {
    // Agendamento já criado como "compareceu" também precisa levar o card junto.
    await syncDealsOnAttendance(supabase, { leadId, appointmentId: created?.id ?? null });
  }

  revalidatePath("/app");
  revalidatePath("/app/agendamentos");
  revalidatePath("/app/leads");
  revalidatePath("/app/funil");

  return NextResponse.json({ ok: true, message: completionMessage });
}
