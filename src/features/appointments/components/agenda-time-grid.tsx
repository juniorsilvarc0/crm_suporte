import { AppointmentDetailsDialog } from "@/features/appointments/components/appointment-details-dialog";
import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import {
  appointmentToneClass,
  formatTipoEnsaio,
} from "@/features/appointments/components/agenda-utils";
import {
  GRID_END_HOUR,
  GRID_HEIGHT,
  GRID_START_HOUR,
  HOUR_HEIGHT,
  TWO_LINE_HEIGHT,
  layoutTimeGrid,
  type TimeGridPlacement,
} from "@/features/appointments/lib/time-grid-layout";
import {
  blockMinutesInDay,
  blocksForDateKey,
  describeAgendaBlockForDate,
  type AgendaBlock,
} from "@/features/appointments/lib/agenda-blocks";
import type { Appointment } from "@/features/appointments/types";
import {
  dateKeyToAppDate,
  formatDayNumber,
  formatTime,
  formatWeekdayShort,
  getWeekDateKeys,
  toAppDateKey,
} from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

const gridRows = GRID_END_HOUR - GRID_START_HOUR;

/** Minutos desde a meia-noite, lidos no fuso do app (nunca `getHours()`). */
function startMinutesOf(appointment: Appointment) {
  const [hour, minute] = formatTime(appointment.scheduled_at).split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

export function TimeGridView({
  mode,
  dateKey,
  appointments,
  blocks,
  todayKey,
}: {
  mode: "week" | "day";
  dateKey: string;
  appointments: Appointment[];
  blocks: AgendaBlock[];
  todayKey: string;
}) {
  const dayKeys = mode === "week" ? getWeekDateKeys(dateKey) : [dateKey];
  const byDay = new Map<string, Appointment[]>(dayKeys.map((key) => [key, []]));
  for (const appointment of appointments) {
    byDay.get(toAppDateKey(appointment.scheduled_at))?.push(appointment);
  }
  const hours = Array.from({ length: gridRows }, (_, index) => GRID_START_HOUR + index);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {/*
          Sete colunas não cabem num telefone sem virar tiras de 40px. A semana
          rola na horizontal com piso de largura por coluna; o dia não precisa
          de piso nenhum e ocupa o que tiver.
        */}
        <div className={cn("min-w-0", mode === "week" && "min-w-[45rem]")}>
          <div className="sticky top-0 z-20 flex border-b border-border/70 bg-card">
            <div className="w-10 shrink-0 sm:w-12" />
            {dayKeys.map((key) => {
              const date = dateKeyToAppDate(key);
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className="group/day-column flex min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-border/40 py-2"
                >
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {formatWeekdayShort(date)}
                  </span>
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                      isToday && "bg-primary text-primary-foreground"
                    )}
                  >
                    {formatDayNumber(date)}
                  </span>
                  {/*
                    ⚠️ No Tailwind v4 o `hover:` já vive dentro de
                    `@media (hover: hover)`. Deixar o botão só em `group-hover`
                    o tornava INALCANÇÁVEL no toque — e a grade não tem versão
                    mobile alternativa como o mês tem. Onde não há hover, ele
                    fica visível.
                  */}
                  <span className="opacity-0 transition-opacity group-hover/day-column:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    <AppointmentDialog
                      trigger={{ kind: "new", dateKey: key }}
                      triggerLabel="Agendar"
                      triggerAriaLabel={`Agendar em ${key}`}
                      triggerVariant="ghost"
                      triggerSize="icon-sm"
                      triggerClassName="size-6 text-muted-foreground hover:text-foreground"
                      iconOnly
                    />
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex">
            <div className="w-10 shrink-0 sm:w-12">
              {hours.map((hour) => (
                <div key={hour} style={{ height: HOUR_HEIGHT }} className="relative">
                  <span className="absolute -top-2 right-1.5 text-[10px] tabular-nums text-muted-foreground">
                    {String(hour).padStart(2, "0")}h
                  </span>
                </div>
              ))}
            </div>
            {dayKeys.map((key) => (
              <DayColumn
                key={key}
                appointments={byDay.get(key) ?? []}
                blocks={blocksForDateKey(blocks, key)}
                dateKey={key}
                hours={hours}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DayColumn({
  appointments,
  blocks,
  dateKey,
  hours,
}: {
  appointments: Appointment[];
  blocks: AgendaBlock[];
  dateKey: string;
  hours: number[];
}) {
  const placements = layoutTimeGrid(
    appointments.map((appointment) => ({
      id: appointment.id,
      startMinutes: startMinutesOf(appointment),
      durationMin: appointment.duration_min ?? 60,
    }))
  );
  const placementById = new Map(placements.map((placement) => [placement.id, placement]));

  return (
    <div
      className="relative min-w-0 flex-1 border-l border-border/40"
      style={{ height: GRID_HEIGHT }}
    >
      {hours.map((hour) => (
        <div key={hour} style={{ height: HOUR_HEIGHT }} className="border-b border-border/30" />
      ))}

      {blocks.map((block) => {
        const span = blockMinutesInDay(block, dateKey);
        const description = describeAgendaBlockForDate(block, dateKey);
        if (!span || !description) return null;
        const top = Math.max(0, span.startMinutes - GRID_START_HOUR * 60);
        const height = Math.min(
          span.endMinutes - Math.max(span.startMinutes, GRID_START_HOUR * 60),
          GRID_HEIGHT - top
        );
        if (height <= 0) return null;

        return (
          <div
            key={block.id}
            role="note"
            title={description.label}
            aria-label={`Bloqueio: ${description.label}`}
            className="pointer-events-none absolute inset-x-0 min-w-0 overflow-hidden border-y border-muted-foreground/10 bg-muted/20"
            style={{ top, height }}
          >
            <span
              className="absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--color-muted-foreground)_0,var(--color-muted-foreground)_1px,transparent_1px,transparent_7px)] opacity-[0.14]"
              aria-hidden
            />
            {height >= 22 ? (
              <span className="relative flex min-w-0 items-center gap-1 overflow-hidden px-1.5 pt-0.5 text-[10px] font-medium leading-tight text-muted-foreground">
                <span className="shrink-0 whitespace-nowrap tabular-nums">
                  {description.period}
                </span>
                <span aria-hidden>·</span>
                <span className="min-w-0 flex-1 truncate">{description.reason}</span>
              </span>
            ) : null}
          </div>
        );
      })}

      {appointments.map((appointment) => {
        const placement = placementById.get(appointment.id);
        if (!placement) return null;
        return (
          <EventBlock key={appointment.id} appointment={appointment} placement={placement} />
        );
      })}
    </div>
  );
}

function EventBlock({
  appointment,
  placement,
}: {
  appointment: Appointment;
  placement: TimeGridPlacement;
}) {
  // Mesmo card do mês, em duas densidades. Abaixo de `TWO_LINE_HEIGHT` só cabe
  // uma linha — e ela leva hora **e** nome, não a hora sozinha: era isso que
  // fazia meia hora aparecer como "10:30" e mais nada.
  const twoLines = placement.height >= TWO_LINE_HEIGHT;

  return (
    <div
      // 2px em volta: separa faixas vizinhas e descola o card da linha da
      // grade, sem inventar margem que reduza a área de toque.
      className="absolute p-0.5"
      style={{
        top: placement.top,
        height: placement.height,
        left: `${placement.leftPct}%`,
        width: `${placement.widthPct}%`,
      }}
    >
      <AppointmentDetailsDialog
        appointment={appointment}
        triggerClassName="block h-full w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span
          className={cn(
            // `overflow-hidden` + `min-w-0` é o que impede o texto de sair do
            // card; `ring` no lugar de `border` para a faixa vizinha não ganhar
            // 2px de largura só por ter moldura.
            "flex h-full min-w-0 flex-col justify-start overflow-hidden rounded-md px-1.5 py-0.5 text-left ring-1 ring-inset ring-black/5 transition-[filter] hover:brightness-[0.97] dark:ring-white/10",
            appointmentToneClass(appointment)
          )}
        >
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="shrink-0 text-[11px] font-semibold tabular-nums leading-tight">
              {formatTime(appointment.scheduled_at)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight">
              {appointment.leads?.name ?? "Sem nome"}
            </span>
          </span>
          {twoLines ? (
            <span className="block truncate text-[10px] font-medium leading-tight opacity-75">
              {formatTipoEnsaio(appointment.tipo_ensaio)}
            </span>
          ) : null}
        </span>
      </AppointmentDetailsDialog>
    </div>
  );
}
