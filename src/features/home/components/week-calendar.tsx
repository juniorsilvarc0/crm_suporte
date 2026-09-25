"use client";

import Link from "next/link";
import { useMemo } from "react";

import type { HomeAppointment } from "@/features/home/types";
import { patientSexLabel } from "@/features/patients/types";
import { formatTime, getTodayAppDateKey, toAppDateKey } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

/**
 * Paleta dos chips: a cor DIZ o sexo do paciente — menino em azul e verde,
 * menina em rosa e vermelho. É o que deixa a semana legível de relance numa
 * clínica que atende crianças.
 *
 * Tons pastel na mesma convenção dos post-its (`noteColorClass`): fundo claro
 * com texto escuro da mesma família, que continua legível no tema escuro.
 *
 * ⚠️ Cor não pode ser o ÚNICO portador da informação (WCAG 1.4.1). Em pastel,
 * emerald-100 e red-100 ficam a 5/255 um do outro para quem tem deuteranopia —
 * ou seja, para ~6% dos homens a paleta simplesmente não existe. Por isso o
 * sexo também vai por escrito no `title` do chip.
 */
const SEX_TONES = {
  masculino: [
    "bg-sky-100 text-sky-950 ring-sky-300/70 dark:bg-sky-300/25 dark:text-sky-50 dark:ring-sky-300/30",
    "bg-emerald-100 text-emerald-950 ring-emerald-300/70 dark:bg-emerald-300/25 dark:text-emerald-50 dark:ring-emerald-300/30",
  ],
  // `pink` e não `rose`: em tom pastel, rose-100 e red-100 ficam quase
  // idênticos e o par deixaria de se distinguir.
  feminino: [
    "bg-pink-100 text-pink-950 ring-pink-300/70 dark:bg-pink-300/25 dark:text-pink-50 dark:ring-pink-300/30",
    "bg-red-100 text-red-950 ring-red-300/70 dark:bg-red-300/25 dark:text-red-50 dark:ring-red-300/30",
  ],
} as const;

/**
 * Sem sexo na ficha (ou intersexo): cinza declarado.
 *
 * ⚠️ `slate-200`, não `slate-100`: em pastel, o 100 fica a 18/255 do `sky-100`
 * e, para quem tem deuteranopia, a 5/255 — "ainda não preencheram a ficha"
 * apareceria como "menino".
 */
const NEUTRAL_TONE =
  "bg-slate-200 text-slate-900 ring-slate-400/60 dark:bg-slate-400/25 dark:text-slate-50 dark:ring-slate-300/30";

function toneFor(appointment: HomeAppointment): string {
  // Cancelado e falta seguem fora da paleta: ali a cor é o estado, e vem
  // acompanhada de texto riscado.
  if (appointment.status === "cancelado" || appointment.status === "faltou") {
    return "bg-muted text-muted-foreground ring-border line-through";
  }

  const pair =
    appointment.sex === "masculino"
      ? SEX_TONES.masculino
      : appointment.sex === "feminino"
        ? SEX_TONES.feminino
        : null;
  if (!pair) return NEUTRAL_TONE;

  // Qual dos dois tons do par: derivado do LEAD, não do agendamento — é isso
  // que mantém a cor estável nas quatro semanas da pessoa. (A mesma criança
  // que volta por outro número vira outro lead e pode cair no outro tom do par;
  // continua sendo a cor certa para o sexo, só não é a mesma de antes.)
  const seed = appointment.leadId ?? appointment.id;
  let hash = 0;
  for (const char of seed) hash = (hash + char.charCodeAt(0)) % 997;
  return pair[hash % pair.length];
}

/** Minutos desde a meia-noite, no fuso do app (nunca no fuso de quem executa). */
function minutesOfDay(iso: string): number {
  const [hour, minute] = formatTime(iso).split(":");
  return Number(hour) * 60 + Number(minute);
}

function dayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-");
  // Meio-dia UTC evita que o dia "escorregue" para o anterior em fuso negativo.
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  return `${DAY_LABELS[weekday]} ${day}/${month}${year ? "" : ""}`;
}

/**
 * Preview semanal: 7 colunas, uma faixa por hora, agendamento posicionado pelo
 * minuto exato. É um **preview** — editar acontece na Agenda, e cada chip leva
 * para lá no dia certo.
 */
export function WeekCalendar({
  dayKeys,
  appointments,
  startHour = 8,
  endHour = 21,
}: {
  dayKeys: string[];
  appointments: HomeAppointment[];
  startHour?: number;
  endHour?: number;
}) {
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index),
    [startHour, endHour]
  );

  const byDay = useMemo(() => {
    const map = new Map<string, HomeAppointment[]>();
    for (const appointment of appointments) {
      const key = toAppDateKey(appointment.startsAt);
      const list = map.get(key) ?? [];
      list.push(appointment);
      map.set(key, list);
    }
    return map;
  }, [appointments]);

  const totalMinutes = (endHour - startHour + 1) * 60;
  const todayKey = getTodayAppDateKey();

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 lg:flex-1">
      <div className="grid shrink-0 grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-border/60 bg-card">
        <span />
        {dayKeys.map((dayKey) => (
          <span
            key={dayKey}
            className={cn(
              "truncate px-1 py-2 text-center text-[11px] font-medium",
              dayKey === todayKey ? "font-semibold text-primary" : "text-muted-foreground"
            )}
          >
            {dayLabel(dayKey)}
          </span>
        ))}
      </div>

      <div className="min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
          <div className="relative" style={{ height: totalMinutes }}>
            {hours.map((hour, index) => (
              <span
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] tabular-nums text-muted-foreground"
                style={{ top: index * 60 }}
              >
                {String(hour).padStart(2, "0")}h
              </span>
            ))}
          </div>

          {dayKeys.map((dayKey) => (
            <div
              key={dayKey}
              className={cn(
                "relative border-l border-border/50",
                dayKey === todayKey && "bg-primary/[0.04]"
              )}
              style={{ height: totalMinutes }}
            >
              {hours.map((hour, index) => (
                <span
                  key={hour}
                  aria-hidden
                  className="absolute inset-x-0 border-t border-border/40"
                  style={{ top: index * 60 }}
                />
              ))}

              {(byDay.get(dayKey) ?? []).map((appointment) => {
                const offset = minutesOfDay(appointment.startsAt) - startHour * 60;
                if (offset < 0 || offset > totalMinutes) return null;
                const duration = appointment.endsAt
                  ? Math.max(24, minutesOfDay(appointment.endsAt) - minutesOfDay(appointment.startsAt))
                  : 45;

                return (
                  <Link
                    key={appointment.id}
                    href={`/app/agendamentos?date=${dayKey}&view=dia`}
                    title={[
                      `${formatTime(appointment.startsAt)}${appointment.endsAt ? `–${formatTime(appointment.endsAt)}` : ""}`,
                      appointment.personName,
                      // O que a cor diz, escrito: ver o aviso em `SEX_TONES`.
                      appointment.sex ? patientSexLabel[appointment.sex] : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    className={cn(
                      // O anel interno dá contorno ao chip pastel: sem ele, o
                      // fundo claro se dissolve na grade branca.
                      "absolute inset-x-0.5 overflow-hidden rounded-md px-1.5 py-1 text-[10px] leading-tight shadow-sm ring-1 ring-inset outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
                      toneFor(appointment)
                    )}
                    style={{ top: offset, height: Math.min(duration, totalMinutes - offset) }}
                  >
                    <span className="block truncate font-mono tabular-nums opacity-90">
                      {formatTime(appointment.startsAt)}
                    </span>
                    <span className="block truncate font-medium">{appointment.personName}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
