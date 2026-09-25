import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MonthCalendar } from "@/features/appointments/components/agenda-month-view";
import type { DayGroup } from "@/features/appointments/components/agenda-utils";
import { localToIso, type AgendaBlock } from "@/features/appointments/lib/agenda-blocks";

vi.mock("@/features/appointments/components/appointment-details-dialog", () => ({
  AppointmentDetailsDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/features/appointments/components/appointment-dialog", () => ({
  AppointmentDialog: ({ triggerLabel }: { triggerLabel: string }) => (
    <button type="button">{triggerLabel}</button>
  ),
}));

const days: DayGroup[] = [
  {
    key: "2026-08-11",
    appointments: [],
    inCurrentMonth: true,
  },
];

function agendaBlock({
  id,
  start,
  end,
  allDay = false,
  reason,
}: {
  id: string;
  start: string;
  end: string;
  allDay?: boolean;
  reason: string;
}): AgendaBlock {
  return {
    id,
    startsAt: localToIso("2026-08-11", start),
    endsAt: localToIso(allDay ? "2026-08-12" : "2026-08-11", end),
    allDay,
    reason,
  };
}

function renderCalendar(blocks: AgendaBlock[]) {
  render(
    <MonthCalendar
      days={days}
      blocks={blocks}
      monthKey="2026-08"
      todayKey="2026-08-11"
    />
  );

  const desktopCell = screen
    .getAllByRole("gridcell")
    .find((cell) => cell.tagName === "SECTION");
  expect(desktopCell).toBeDefined();
  return desktopCell as HTMLElement;
}

describe("MonthCalendar — bloqueios", () => {
  it("mostra intervalo sem hachurar o dia para bloqueio parcial", () => {
    const cell = renderCalendar([
      agendaBlock({
        id: "jantar",
        start: "17:00",
        end: "20:00",
        reason: "Jantar laboratório",
      }),
    ]);

    expect(cell).toHaveAttribute("data-block-coverage", "partial");
    expect(cell.className).not.toContain("repeating-linear-gradient");
    expect(screen.getAllByText("17:00–20:00").length).toBeGreaterThan(0);
  });

  it("mantém hachura e identificação para bloqueio de dia inteiro", () => {
    const cell = renderCalendar([
      agendaBlock({
        id: "cirurgia",
        start: "00:00",
        end: "00:00",
        allDay: true,
        reason: "Cirurgia",
      }),
    ]);

    expect(cell).toHaveAttribute("data-block-coverage", "all-day");
    expect(cell.className).toContain("repeating-linear-gradient");
    expect(screen.getAllByText("Dia inteiro").length).toBeGreaterThan(0);
  });

  it("preserva múltiplos bloqueios no mesmo dia", () => {
    renderCalendar([
      agendaBlock({ id: "almoco", start: "12:00", end: "13:00", reason: "Almoço" }),
      agendaBlock({ id: "jantar", start: "17:00", end: "20:00", reason: "Jantar" }),
    ]);

    expect(screen.getAllByText("12:00–13:00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("17:00–20:00").length).toBeGreaterThan(0);
  });
});
