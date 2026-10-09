import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import { localToIso, type AgendaBlock } from "@/features/appointments/lib/agenda-blocks";

const ANA = { id: "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b", name: "Ana Lima" };
const BRUNO = { id: "8f14e45f-ceea-4e67-a3b1-9c0d1e2f3a4b", name: "Bruno Costa" };

const block = (overrides: Partial<AgendaBlock>): AgendaBlock => ({
  id: "b1",
  startsAt: localToIso("2026-10-12", "00:00"),
  endsAt: localToIso("2026-10-13", "00:00"),
  allDay: true,
  reason: "Feriado",
  assignee: null,
  ...overrides,
});

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
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** A equipe e os bloqueios do dia, por URL; guarda as URLs pedidas. */
function stubFetch(blocks: AgendaBlock[]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url) === "/api/app-users") return new Response(JSON.stringify({ users: [ANA, BRUNO] }));
    if (String(url).startsWith("/api/agenda-blocks?")) return new Response(JSON.stringify({ ok: true, blocks }));
    throw new Error(`fetch inesperado: ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialog() {
  render(<AppointmentDialog dateKey="2026-10-12" open onOpenChange={vi.fn()} />);
  return screen.findByRole("dialog");
}

describe("AppointmentDialog — bloqueios", () => {
  it("busca os bloqueios do dia escolhido, de meia-noite a meia-noite no fuso do app", async () => {
    const fetchMock = stubFetch([]);
    await renderDialog();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/agenda-blocks?from=${encodeURIComponent("2026-10-12T03:00:00.000Z")}&to=${encodeURIComponent("2026-10-13T03:00:00.000Z")}`
      )
    );
  });

  it("avisa quando o horário cai num bloqueio de todos, sem impedir", async () => {
    stubFetch([block({})]);
    const dialog = await renderDialog();

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Horário com bloqueio");
    expect(alert).toHaveTextContent("Feriado · Dia inteiro");
    expect(within(dialog).getByRole("button", { name: "Criar agendamento" })).toBeEnabled();
  });

  it("bloqueio de um técnico só avisa quando ELE é o escolhido", async () => {
    const user = userEvent.setup();
    stubFetch([block({ reason: "Férias", assignee: BRUNO })]);
    const dialog = await renderDialog();

    // Sem técnico (ou com outro), as férias do Bruno não atrapalham.
    await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());

    await user.click(within(dialog).getByRole("combobox", { name: "Técnico" }));
    await user.click(await screen.findByRole("option", { name: "Bruno Costa" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Bruno Costa: Férias · Dia inteiro");
  });

  it("encosto não é bloqueio: almoço até 13:00 não atrapalha a visita das 13:00", async () => {
    const user = userEvent.setup();
    stubFetch([
      block({
        allDay: false,
        reason: "Almoço",
        startsAt: localToIso("2026-10-12", "12:00"),
        endsAt: localToIso("2026-10-12", "13:00"),
      }),
    ]);
    const dialog = await renderDialog();
    const hora = within(dialog).getByLabelText(/Hora/);

    await user.clear(hora);
    await user.type(hora, "12:30");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Almoço · 12:00–13:00");

    await user.clear(hora);
    await user.type(hora, "13:00");
    await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());
  });
});
