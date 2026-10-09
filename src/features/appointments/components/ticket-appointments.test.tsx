import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import type { AppointmentTicketContext } from "@/features/appointments/components/appointment-dialog";
import { TicketAppointments } from "@/features/appointments/components/ticket-appointments";
import type { AppointmentListItem } from "@/features/appointments/types";

const TICKET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CONTACT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CUSTOMER_ID = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";
const APPOINTMENT_ID = "8f14e45f-ceea-4e67-a3b1-9c0d1e2f3a4b";

const CONTEXT: AppointmentTicketContext = {
  ticket: { id: TICKET_ID, number: 1024, title: "Erro ao emitir nota fiscal" },
  customer: { id: CUSTOMER_ID, name: "Padaria São João" },
  contactId: CONTACT_ID,
};

const appointment = (overrides: Partial<AppointmentListItem> = {}): AppointmentListItem => ({
  id: APPOINTMENT_ID,
  kind: "visita_tecnica",
  title: "Trocar a impressora fiscal",
  status: "agendado",
  scheduled_at: "2026-10-12T13:00:00+00:00",
  duration_min: 60,
  location: "Loja do centro",
  notes: null,
  ticket_id: TICKET_ID,
  customer_id: CUSTOMER_ID,
  contact_id: CONTACT_ID,
  assignee_id: null,
  created_by_user_id: null,
  created_at: "2026-10-09T12:00:00+00:00",
  updated_at: "2026-10-09T12:00:00+00:00",
  customer: { id: CUSTOMER_ID, legal_name: "Padaria S. João Ltda", trade_name: "Padaria São João" },
  contact: { id: CONTACT_ID, name: "Maria Souza", phone: "5527999990000" },
  ticket: { id: TICKET_ID, number: 1024, title: "Erro ao emitir nota fiscal", status: "em_atendimento" },
  assignee: { id: "u1", name: "Ana Lima" },
  ...overrides,
});

const originalMatchMedia = window.matchMedia;

// O Dialog decide entre caixa e gaveta pela largura: no teste, desktop.
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
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A equipe do select de técnico e a escrita do compromisso. */
function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url) === "/api/app-users") return jsonResponse(200, { users: [] });
    if (init?.method === "POST" || init?.method === "PATCH") {
      return jsonResponse(200, { ok: true, appointment: { id: APPOINTMENT_ID } });
    }
    throw new Error(`fetch inesperado: ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function writeOf(fetchMock: ReturnType<typeof stubFetch>) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST" || init?.method === "PATCH");
  if (!call) throw new Error("nenhuma escrita");
  const [url, init] = call as unknown as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe("TicketAppointments", () => {
  it("diz que não há agendamento e oferece Agendar no ticket em aberto", () => {
    render(<TicketAppointments context={CONTEXT} appointments={[]} editable />);

    expect(screen.getByText("Nenhum agendamento.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agendar" })).toBeInTheDocument();
  });

  it("lista o compromisso com tipo, situação, assunto, técnico e local", () => {
    render(<TicketAppointments context={CONTEXT} appointments={[appointment()]} editable />);

    expect(screen.getByText("Visita técnica")).toBeInTheDocument();
    expect(screen.getByText("Agendado")).toBeInTheDocument();
    expect(screen.getByText("Trocar a impressora fiscal")).toBeInTheDocument();
    expect(screen.getByText("Ana Lima · Loja do centro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar agendamento" })).toBeInTheDocument();
  });

  it("no ticket encerrado mostra os compromissos só para leitura", () => {
    render(<TicketAppointments context={CONTEXT} appointments={[appointment()]} editable={false} />);

    expect(screen.getByText("Trocar a impressora fiscal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agendar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar agendamento" })).not.toBeInTheDocument();
  });

  it("agenda a partir do ticket: o compromisso nasce ligado ao ticket, ao contato e à empresa", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    render(<TicketAppointments context={CONTEXT} appointments={[]} editable />);

    await user.click(screen.getByRole("button", { name: "Agendar" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("SUP-1024");
    expect(dialog).toHaveTextContent("Erro ao emitir nota fiscal");
    expect(dialog).toHaveTextContent("Padaria São João");

    await user.click(screen.getByRole("button", { name: "Criar agendamento" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const write = writeOf(fetchMock);
    expect(write.url).toBe("/api/appointments");
    expect(write.method).toBe("POST");
    expect(write.body).toMatchObject({
      kind: "visita_tecnica",
      ticket_id: TICKET_ID,
      contact_id: CONTACT_ID,
      customer_id: CUSTOMER_ID,
    });
    expect(toastMock.success).toHaveBeenCalledWith("Agendamento criado.");
  });

  it("editar não reenvia o vínculo: o ticket e o contato não se trocam pelo diálogo", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    render(<TicketAppointments context={CONTEXT} appointments={[appointment()]} editable />);

    await user.click(screen.getByRole("button", { name: "Editar agendamento" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("SUP-1024");

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const write = writeOf(fetchMock);
    expect(write.url).toBe(`/api/appointments/${APPOINTMENT_ID}`);
    expect(write.method).toBe("PATCH");
    expect(write.body).not.toHaveProperty("ticket_id");
    expect(write.body).not.toHaveProperty("contact_id");
  });
});
