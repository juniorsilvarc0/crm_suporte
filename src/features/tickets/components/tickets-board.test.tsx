import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TicketsBoard, type TicketsBoardCatalog } from "@/features/tickets/components/tickets-board";
import { parseTicketListParams } from "@/features/tickets/queries/get-tickets-page";
import type { TicketListItem, TicketStatusOption, TicketTransition } from "@/features/tickets/types";

const { refreshMock, replaceMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));
vi.mock("sonner", () => ({ toast: { success: successMock, error: errorMock } }));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const NON_TERMINAL = [
  "novo",
  "em_triagem",
  "em_atendimento",
  "aguardando_cliente",
  "aguardando_interno",
] as const;

const statuses: TicketStatusOption[] = [
  ...NON_TERMINAL.map((key, i) => ({
    key,
    label: key === "em_atendimento" ? "Em atendimento" : key,
    color: "blue",
    position: i,
    sla_mode: "running" as const,
    is_terminal: false,
  })),
  { key: "resolvido", label: "Resolvido", color: "emerald", position: 5, sla_mode: "stopped", is_terminal: true },
  { key: "cancelado", label: "Cancelado", color: "gray", position: 7, sla_mode: "stopped", is_terminal: true },
];

const transitions: TicketTransition[] = [
  { from_status: "em_atendimento", to_status: "resolvido" },
  { from_status: "em_atendimento", to_status: "cancelado" },
];

const catalog: TicketsBoardCatalog = { statuses, transitions, queues: null };

function ticket(overrides: Partial<TicketListItem> = {}): TicketListItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    number: 1024,
    title: "Sistema travando",
    status: "em_atendimento",
    priority: "alta",
    version: 3,
    source: "ai",
    conversation_id: "22222222-2222-4222-8222-222222222222",
    is_terminal: false,
    reopened_count: 0,
    sla_mode: "running",
    sla_first_response_minutes: 60,
    sla_resolution_minutes: 480,
    sla_warn_pct: 80,
    first_response_due_at: "2026-10-08T10:00:00Z",
    resolution_due_at: "2026-10-08T17:00:00Z",
    first_responded_at: null,
    sla_paused_at: null,
    resolved_at: null,
    closed_at: null,
    next_due_at: "2026-10-08T17:00:00Z",
    last_inbound_at: null,
    replied_after_resolve: false,
    created_at: "2026-10-08T09:00:00Z",
    updated_at: "2026-10-08T09:00:00Z",
    customer: null,
    contact: { id: "c1", name: "Maria", phone: "5586999990000" },
    product: null,
    assignee: null,
    ...overrides,
  };
}

function renderBoard(items: TicketListItem[] | null) {
  return render(
    <TicketsBoard
      board={{ items, capped: false, fetchedAt: "2026-10-08T09:00:00Z" }}
      params={parseTicketListParams({})}
      catalog={catalog}
      users={null}
      viewerId="viewer-1"
    />
  );
}

// O ModalShell do diálogo de cancelamento pergunta a largura (useIsMobile).
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

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  successMock.mockReset();
  errorMock.mockReset();
  fetchMock.mockResolvedValue(
    jsonResponse({ ok: true, ticket: { version: 4 }, from: "em_atendimento", to: "resolvido", changed: true })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TicketsBoard", () => {
  it("mostra as colunas não-terminais e o card", () => {
    renderBoard([ticket()]);

    expect(screen.getByText("Em atendimento")).toBeInTheDocument();
    expect(screen.getByText("Sistema travando")).toBeInTheDocument();
    expect(screen.getByText("SUP-1024")).toBeInTheDocument();
    // Resolvido/Cancelado são terminais: não viram coluna.
    expect(screen.queryByText("Resolvido")).not.toBeInTheDocument();
  });

  it("items null mostra erro com 'Tentar de novo'", async () => {
    renderBoard(null);

    expect(screen.getByText("Não foi possível carregar o quadro.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("'Mover para' posta a transição com a versão lida e relê", async () => {
    renderBoard([ticket()]);

    await userEvent.click(screen.getByRole("button", { name: "Ações de SUP-1024" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Resolvido/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/tickets/11111111-1111-4111-8111-111111111111/transition");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ to: "resolvido", version: 3 });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("'Mover para Cancelado' abre o diálogo de motivo, não posta direto", async () => {
    renderBoard([ticket()]);

    await userEvent.click(screen.getByRole("button", { name: "Ações de SUP-1024" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Cancelado/ }));

    expect(await screen.findByText("Cancelar SUP-1024?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
