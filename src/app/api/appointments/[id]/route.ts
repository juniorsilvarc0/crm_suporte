import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { syncLeadStatusFromDeals } from "@/features/deals/queries/sync-lead-status";
import { localDateTimeToIso } from "@/lib/formatters/date";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

/**
 * Edição de agendamento.
 *
 * ⚠️ **Sem `status` e sem troca de cliente**, de propósito.
 *
 * Mudar o status tem efeito em cascata: `compareceu` carimba `compareceu_at` no
 * lead **e move o card no funil** (`syncDealsOnAttendance`). Esse caminho vive
 * no botão "Marcar compareceu" e é o único que faz a cascata inteira — duplicar
 * a regra aqui é como as duas versões passam a divergir. Trocar o cliente é
 * outra história ainda: mexeria no lead antigo e no novo.
 */
const updateAppointmentSchema = z.object({
  scheduled_at: z
    .string()
    .min(1, "Informe data e hora.")
    .refine((value) => localDateTimeToIso(value) !== "", "Data inválida."),
  tipo_ensaio: optionalText,
  duration_min: z.coerce.number().int().positive().default(60),
  notes: optionalText,
  modality: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(["presencial", "teleconsulta"]).optional()
  ),
  unit_id: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.uuid().optional()
  ),
  created_by_user_id: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().uuid().optional()
  ),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = updateAppointmentSchema.safeParse(body.data);
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

  const { data: existing, error: existingError } = await supabase
    .from("appointments")
    .select("id, lead_id, scheduled_at, status")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ ok: false, message: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json(
      { ok: false, message: "Agendamento não encontrado." },
      { status: 404 }
    );
  }

  const scheduledAtIso = localDateTimeToIso(parsed.data.scheduled_at);

  const { error: updateError } = await supabase
    .from("appointments")
    .update({
      scheduled_at: scheduledAtIso,
      tipo_ensaio: parsed.data.tipo_ensaio ?? null,
      duration_min: parsed.data.duration_min,
      notes: parsed.data.notes ?? null,
      modality: parsed.data.modality ?? null,
      unit_id: parsed.data.unit_id ?? null,
      ...(parsed.data.created_by_user_id
        ? { created_by_user_id: parsed.data.created_by_user_id }
        : {}),
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ ok: false, message: updateError.message }, { status: 500 });
  }

  // Remarcar move a data: o `leads.agendado_at` apontava para o horário antigo.
  //
  // O filtro por `eq("agendado_at", <antigo>)` é o que impede pisar no carimbo
  // de OUTRO agendamento do mesmo lead — se o lead tem dois, só o dono da marca
  // atual é atualizado. Sem isso, remarcar o agendamento de terça reescreveria
  // a data do de quinta.
  const rescheduled = existing.scheduled_at !== scheduledAtIso;
  const stillScheduled = existing.status === "agendado" || existing.status === "confirmado";

  if (rescheduled && stillScheduled && existing.lead_id && existing.scheduled_at) {
    const { error: leadError } = await supabase
      .from("leads")
      .update({ agendado_at: scheduledAtIso })
      .eq("id", existing.lead_id)
      .eq("agendado_at", existing.scheduled_at);

    if (leadError) {
      // A remarcação já valeu; o carimbo do lead é secundário e não justifica
      // devolver erro para quem só queria mudar o horário.
      console.error("[PATCH /api/appointments/[id]] agendado_at do lead:", leadError);
    }
  }

  revalidatePath("/app");
  revalidatePath("/app/agendamentos");
  revalidatePath("/app/leads");
  revalidatePath("/app/funil");

  return NextResponse.json({ ok: true, message: "Agendamento atualizado." });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  const { data: appointment, error: appointmentError } = await supabase
    .from("appointments")
    .select("id, lead_id")
    .eq("id", id)
    .maybeSingle();

  if (appointmentError) {
    return NextResponse.json({ ok: false, message: appointmentError.message }, { status: 500 });
  }

  if (!appointment) {
    return NextResponse.json(
      { ok: false, message: "Agendamento não encontrado." },
      { status: 404 }
    );
  }

  const { error: deleteError } = await supabase
    .from("appointments")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ ok: false, message: deleteError.message }, { status: 500 });
  }

  if (appointment.lead_id) {
    // Excluir agenda não remove nem rebaixa oportunidade. O card continua
    // sendo a verdade comercial e a pessoa permanece como sua projeção.
    await syncLeadStatusFromDeals(supabase, { leadId: appointment.lead_id });
  }

  revalidatePath("/app");
  revalidatePath("/app/agendamentos");
  revalidatePath("/app/leads");

  return NextResponse.json({ ok: true, message: "Agendamento excluído." });
}
