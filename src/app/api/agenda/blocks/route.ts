import { NextResponse } from "next/server";
import { z } from "zod";

import { isValidTime } from "@/features/appointments/lib/agenda-config";
import { localToIso } from "@/features/appointments/lib/agenda-blocks";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O cliente manda data e hora LOCAIS, separadas — o mesmo vocabulário da tela.
 *
 * A conversão para ISO acontece aqui, com `localToIso`, e não no navegador: o
 * app trabalha em `America/Sao_Paulo` e deixar cada cliente resolver o fuso
 * seria confiar no relógio da máquina de quem preencheu.
 */
const createSchema = z
  .object({
    start_date: z.string().regex(DATE_RE, "Data inicial inválida."),
    end_date: z.string().regex(DATE_RE, "Data final inválida."),
    all_day: z.coerce.boolean().default(false),
    start_time: z.string().refine(isValidTime, "Hora inicial inválida.").optional(),
    end_time: z.string().refine(isValidTime, "Hora final inválida.").optional(),
    reason: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().max(120, "No máximo 120 caracteres.").optional()
    ),
  })
  .superRefine((value, ctx) => {
    if (value.all_day) return;
    if (!value.start_time || !value.end_time) {
      ctx.addIssue({
        code: "custom",
        path: ["start_time"],
        message: "Informe o horário inicial e final, ou marque o dia inteiro.",
      });
    }
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

  const parsed = createSchema.safeParse(body.data);
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

  const { start_date, end_date, all_day, start_time, end_time } = parsed.data;

  // Dia inteiro termina na MEIA-NOITE SEGUINTE, não às 23:59. O fim é
  // exclusivo em toda a regra de bloqueio; 23:59 deixaria o último minuto do
  // dia livre, e é o tipo de buraco que só aparece em produção.
  const startsAt = localToIso(start_date, all_day ? "00:00" : start_time ?? "00:00");
  const endsAt = all_day
    ? localToIso(nextDay(end_date), "00:00")
    : localToIso(end_date, end_time ?? "23:59");

  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
    return NextResponse.json(
      {
        ok: false,
        message: "O fim do bloqueio precisa ser depois do início.",
        errors: { end_date: ["O fim precisa ser depois do início."] },
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agenda_blocks")
    .insert({
      starts_at: startsAt,
      ends_at: endsAt,
      all_day,
      reason: parsed.data.reason ?? null,
      created_by_user_id: auth.viewer.id,
    })
    .select("id, starts_at, ends_at, all_day, reason")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível criar o bloqueio." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Bloqueio criado.",
    block: {
      id: data.id,
      startsAt: data.starts_at,
      endsAt: data.ends_at,
      allDay: data.all_day,
      reason: data.reason,
    },
  });
}

/** "AAAA-MM-DD" + 1 dia, em data local. */
function nextDay(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
