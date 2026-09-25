import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentDetailsDialog } from "@/features/appointments/components/appointment-details-dialog";
import type { Appointment } from "@/features/appointments/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { startConversationMock } = vi.hoisted(() => ({
  startConversationMock: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/features/chat/hooks/use-start-conversation", () => ({
  useStartConversation: () => ({
    startConversation: startConversationMock,
    checkingPhone: null,
  }),
}));

const originalMatchMedia = window.matchMedia;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

function appointment(status: Appointment["status"]): Appointment {
  return {
    id: "appointment-1",
    lead_id: null,
    scheduled_at: "2026-08-08T15:00:00-03:00",
    duration_min: 60,
    tipo_ensaio: null,
    status,
    google_event_id: null,
    reminder_d3_sent: false,
    reminder_d0_sent: false,
    notes: null,
    idempotency_key: null,
    created_by_user_id: null,
    modality: null,
    unit_id: null,
    created_at: "2026-08-08T12:00:00-03:00",
    updated_at: "2026-08-08T12:00:00-03:00",
    leads: null,
  };
}

function appointmentWithLead(status: Appointment["status"]): Appointment {
  return {
    ...appointment(status),
    lead_id: "8dfa29f0-9851-4b67-8b87-2d654587fe43",
    leads: {
      id: "8dfa29f0-9851-4b67-8b87-2d654587fe43",
      name: "João da Silva",
      phone: "+55 (86) 99999-9999",
      email: "joao@example.com",
      instagram_user: "joao",
      status: "agendado",
      source: "whatsapp",
      tipo_ensaio: "consulta",
      interesse: "Consulta",
      agencia_nome: null,
      modelo_nome: null,
      is_recorrente: false,
      valor_estimado: 650,
      notes: "Retorno em agosto",
      created_at: "2026-08-01T12:00:00-03:00",
      last_message_at: "2026-08-08T12:00:00-03:00",
    },
  };
}

describe("AppointmentDetailsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mostra Visitou sem duplicar o controle de fechar", () => {
    render(<AppointmentDetailsDialog appointment={appointment("agendado")} open />);

    expect(screen.getByRole("button", { name: "Visitou" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Fechar" })).toHaveLength(1);
  });

  it("não oferece Visitou depois de registrar comparecimento", () => {
    render(<AppointmentDetailsDialog appointment={appointment("compareceu")} open />);

    expect(screen.queryByRole("button", { name: "Visitou" })).not.toBeInTheDocument();
  });

  it("abre o WhatsApp pelo fluxo compartilhado de conversa", async () => {
    const user = userEvent.setup();
    render(<AppointmentDetailsDialog appointment={appointmentWithLead("agendado")} open />);

    await user.click(screen.getByRole("button", { name: "Abrir conversa no WhatsApp" }));

    expect(startConversationMock).toHaveBeenCalledWith(
      "5586999999999",
      "João da Silva"
    );
  });

  it("troca o próprio conteúdo pelo painel de edição do lead", async () => {
    const user = userEvent.setup();
    render(<AppointmentDetailsDialog appointment={appointmentWithLead("agendado")} open />);

    await user.click(screen.getByRole("button", { name: "Editar lead" }));

    expect(screen.getByRole("heading", { name: "Editar lead" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Informações principais" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("João da Silva");
    expect(screen.getByRole("button", { name: "Voltar ao agendamento" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Visitou" })).not.toBeInTheDocument();
  });
});
