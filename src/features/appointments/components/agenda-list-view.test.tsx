import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MonthAgendaList } from "@/features/appointments/components/agenda-list-view";
import type { DayGroup } from "@/features/appointments/components/agenda-utils";
import type { Appointment } from "@/features/appointments/types";
import { useMediaQuery } from "@/lib/use-media-query";

vi.mock("@/lib/use-media-query", () => ({ useMediaQuery: vi.fn() }));

vi.mock("@/components/ui/overlay-scroll-area", () => ({
  OverlayScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/forms/form-select", () => ({
  FormSelect: ({
    value,
    onValueChange,
    options,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    "aria-label": string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock("@/features/appointments/components/appointment-dialog", () => ({
  AppointmentDialog: ({ triggerLabel }: { triggerLabel: string }) => (
    <button type="button">{triggerLabel}</button>
  ),
}));

vi.mock("@/features/appointments/components/agenda-appointment-card", () => ({
  AppointmentCard: ({ appointment }: { appointment: Appointment }) => (
    <div data-testid={`appointment-${appointment.id}`}>{appointment.id}</div>
  ),
}));

function item(id: string, scheduledAt: string): Appointment {
  return {
    id,
    lead_id: null,
    scheduled_at: scheduledAt,
    duration_min: 60,
    tipo_ensaio: null,
    status: "agendado",
    google_event_id: null,
    reminder_d3_sent: false,
    reminder_d0_sent: false,
    notes: null,
    idempotency_key: null,
    created_by_user_id: null,
    modality: null,
    unit_id: null,
    created_at: scheduledAt,
    updated_at: scheduledAt,
    leads: null,
  };
}

const days: DayGroup[] = [
  {
    key: "2026-08-08",
    appointments: [item("today", "2026-08-08T10:00:00-03:00")],
    inCurrentMonth: true,
  },
  {
    key: "2026-08-12",
    appointments: [item("next", "2026-08-12T10:00:00-03:00")],
    inCurrentMonth: true,
  },
];

describe("MonthAgendaList", () => {
  beforeEach(() => {
    vi.mocked(useMediaQuery).mockReturnValue(true);
  });

  it("mostra um dia por vez no mobile e troca pelo seletor", () => {
    render(<MonthAgendaList days={days} monthKey="2026-08" todayKey="2026-08-08" />);

    expect(screen.getByTestId("appointment-today")).toBeInTheDocument();
    expect(screen.queryByTestId("appointment-next")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Escolher dia com agendamento" }), {
      target: { value: "2026-08-12" },
    });

    expect(screen.queryByTestId("appointment-today")).not.toBeInTheDocument();
    expect(screen.getByTestId("appointment-next")).toBeInTheDocument();
  });
});
