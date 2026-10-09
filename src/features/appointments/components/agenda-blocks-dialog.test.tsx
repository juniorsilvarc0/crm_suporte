import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/formatters/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/formatters/date")>()),
  getTodayAppDateKey: () => "2026-10-09",
}));

import { AgendaBlocksDialog } from "@/features/appointments/components/agenda-blocks-dialog";
import { localToIso, type AgendaBlock } from "@/features/appointments/lib/agenda-blocks";

const ANA = { id: "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b", name: "Ana Lima" };

const FERIADO: AgendaBlock = {
  id: "b1",
  startsAt: localToIso("2026-10-12", "00:00"),
  endsAt: localToIso("2026-10-13", "00:00"),
  allDay: true,
  reason: "Feriado",
  assignee: null,
};

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

/** Equipe, lista de bloqueios e as escritas; `listOk=false` derruba a leitura da lista. */
function stubFetch({ blocks = [FERIADO], listOk = true }: { blocks?: AgendaBlock[]; listOk?: boolean } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path === "/api/app-users") return new Response(JSON.stringify({ users: [ANA] }));
    if (path.startsWith("/api/agenda-blocks?")) {
      return listOk
        ? new Response(JSON.stringify({ ok: true, blocks }))
        : new Response(JSON.stringify({ ok: false }), { status: 500 });
    }
    if (path === "/api/agenda-blocks" && init?.method === "POST") {
      return new Response(JSON.stringify({ ok: true, block: { id: "b2" } }));
    }
    if (path.startsWith("/api/agenda-blocks/") && init?.method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }));
    }
    throw new Error(`fetch inesperado: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof stubFetch>, method: string) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  if (!call) throw new Error(`nenhum ${method}`);
  const [url, init] = call as unknown as [string, RequestInit];
  return { url, body: init.body ? (JSON.parse(String(init.body)) as unknown) : null };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  render(<AgendaBlocksDialog />);
  await user.click(screen.getByRole("button", { name: "Bloqueios da agenda" }));
  return screen.findByRole("dialog");
}

describe("AgendaBlocksDialog", () => {
  it("lista os próximos bloqueios com o período por extenso", async () => {
    const user = userEvent.setup();
    stubFetch();
    const dialog = await open(user);

    expect(await within(dialog).findByText("Feriado")).toBeInTheDocument();
    expect(within(dialog).getByText("12/10 · Dia inteiro")).toBeInTheDocument();
  });

  it("dia inteiro manda o 1º e o último dia, e o técnico escolhido", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ blocks: [] });
    const dialog = await open(user);

    await user.clear(within(dialog).getByLabelText("Primeiro dia"));
    await user.type(within(dialog).getByLabelText("Primeiro dia"), "2026-12-24");
    await user.clear(within(dialog).getByLabelText("Último dia"));
    await user.type(within(dialog).getByLabelText("Último dia"), "2026-12-26");
    await user.type(within(dialog).getByLabelText("Motivo"), "Recesso");
    await user.click(within(dialog).getByRole("combobox", { name: "Técnico" }));
    await user.click(await screen.findByRole("option", { name: "Ana Lima" }));
    await user.click(within(dialog).getByRole("button", { name: "Bloquear" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock, "POST")).toEqual({
      url: "/api/agenda-blocks",
      body: {
        all_day: true,
        start_date: "2026-12-24",
        end_date: "2026-12-26",
        reason: "Recesso",
        assignee_id: ANA.id,
      },
    });
    expect(toastMock.success).toHaveBeenCalledWith("Bloqueio cadastrado.");
  });

  it("horário manda o começo e o fim no mesmo dia; sem técnico é de todos", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ blocks: [] });
    const dialog = await open(user);

    await user.click(within(dialog).getByRole("checkbox", { name: "Dia inteiro" }));
    await user.clear(within(dialog).getByLabelText("Das"));
    await user.type(within(dialog).getByLabelText("Das"), "12:00");
    await user.clear(within(dialog).getByLabelText("Até"));
    await user.type(within(dialog).getByLabelText("Até"), "13:30");
    await user.click(within(dialog).getByRole("button", { name: "Bloquear" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock, "POST").body).toEqual({
      all_day: false,
      starts_at: "2026-10-09T12:00",
      ends_at: "2026-10-09T13:30",
      reason: "",
      assignee_id: "",
    });
  });

  it("excluir manda o DELETE do bloqueio e relê a agenda", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    const dialog = await open(user);

    await user.click(await within(dialog).findByRole("button", { name: "Excluir bloqueio Feriado, 12/10 · Dia inteiro" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock, "DELETE").url).toBe("/api/agenda-blocks/b1");
    expect(toastMock.success).toHaveBeenCalledWith("Bloqueio excluído.");
  });

  it("lista que falhou não diz 'nenhum bloqueio': oferece Tentar de novo", async () => {
    const user = userEvent.setup();
    stubFetch({ listOk: false });
    const dialog = await open(user);

    expect(await within(dialog).findByText("Não foi possível carregar os bloqueios.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Nenhum bloqueio/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });
});
