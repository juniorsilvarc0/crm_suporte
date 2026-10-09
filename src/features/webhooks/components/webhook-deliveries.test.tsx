import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toastMock } = vi.hoisted(() => ({ toastMock: { success: vi.fn(), error: vi.fn() } }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { WEBHOOK_EVENTS } from "@/features/webhooks/catalog";
import { WebhookDeliveries } from "@/features/webhooks/components/webhook-deliveries";
import type { WebhookDelivery, WebhookSubscription } from "@/features/webhooks/types";

const SUBS: WebhookSubscription[] = [
  {
    id: "sub-1",
    name: "ERP",
    url: "https://erp.exemplo.com/hook",
    events: [...WEBHOOK_EVENTS],
    isActive: true,
    hasSecret: true,
    createdAt: "2026-10-09T12:00:00Z",
    updatedAt: "2026-10-09T12:00:00Z",
  },
];

function delivery(over: Partial<WebhookDelivery>): WebhookDelivery {
  return {
    id: "d-1",
    subscriptionId: "sub-1",
    event: "ticket.created",
    eventId: "e-1",
    status: "sent",
    attempts: 1,
    nextAttemptAt: "2026-10-09T15:00:00Z",
    httpStatus: 200,
    error: null,
    createdAt: "2026-10-09T15:00:00Z",
    deliveredAt: "2026-10-09T15:00:01Z",
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let listResponse: () => Response;
const listCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/webhooks/deliveries?"));

beforeEach(() => {
  listResponse = () =>
    Response.json({
      ok: true,
      deliveries: [
        delivery({}),
        delivery({ id: "d-2", status: "retry", attempts: 2, httpStatus: 503, error: "O destino respondeu HTTP 503.", deliveredAt: null }),
        delivery({ id: "d-3", status: "dead_letter", attempts: 8, httpStatus: null, error: "Falha de rede.", deliveredAt: null }),
        delivery({ id: "d-4", subscriptionId: "sub-apagado", status: "skipped", error: "destino removido", deliveredAt: null }),
      ],
    });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ ok: true });
    return listResponse();
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WebhookDeliveries", () => {
  it("lê ao abrir e mostra status em texto, tentativas, HTTP, erro e destino excluído", async () => {
    render(<WebhookDeliveries subscriptions={SUBS} />);
    const items = await screen.findAllByRole("listitem");

    expect(within(items[0]).getByText("Entregue")).toBeInTheDocument();
    expect(within(items[0]).getByText("1 tentativa")).toBeInTheDocument();
    expect(within(items[0]).getByText(/^HTTP 200 · entregue às/)).toBeInTheDocument();
    expect(within(items[1]).getByText("Nova tentativa")).toBeInTheDocument();
    expect(within(items[1]).getByText(/^O destino respondeu HTTP 503\. · próxima tentativa às/)).toBeInTheDocument();
    expect(within(items[2]).getByText("Esgotada")).toBeInTheDocument();
    expect(within(items[3]).getByText(/^Destino excluído ·/)).toBeInTheDocument();
    // Só a esgotada se reenvia.
    expect(screen.getAllByRole("button", { name: "Reenviar" })).toHaveLength(1);
    expect(listCalls()).toHaveLength(1);
  });

  it("reenviar devolve à fila e relê a lista", async () => {
    const user = userEvent.setup();
    render(<WebhookDeliveries subscriptions={SUBS} />);
    await user.click(await screen.findByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Entrega de volta à fila: sai no próximo ciclo."));
    expect(fetchMock).toHaveBeenCalledWith("/api/webhooks/deliveries/d-3/requeue", { method: "POST" });
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });

  it("filtrar relê com o filtro; vazio com filtro diz isso", async () => {
    const user = userEvent.setup();
    render(<WebhookDeliveries subscriptions={SUBS} />);
    await screen.findAllByRole("listitem");

    listResponse = () => Response.json({ ok: true, deliveries: [] });
    await user.click(screen.getByRole("combobox", { name: "Filtrar entregas por status" }));
    await user.click(await screen.findByRole("option", { name: "Esgotada" }));

    expect(await screen.findByText("Nenhuma entrega com esses filtros.")).toBeInTheDocument();
    expect(String(listCalls().at(-1)?.[0])).toBe("/api/webhooks/deliveries?status=dead_letter");
  });

  it("falha de leitura: o motivo e Tentar de novo (nunca uma lista vazia falsa)", async () => {
    listResponse = () => Response.json({ ok: false, message: "Não foi possível ler as entregas." }, { status: 500 });
    const user = userEvent.setup();
    render(<WebhookDeliveries subscriptions={SUBS} />);

    expect(await screen.findByText("Não foi possível ler as entregas.")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma entrega/)).toBeNull();
    listResponse = () => Response.json({ ok: true, deliveries: [delivery({})] });
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Entregue")).toBeInTheDocument();
  });

  it("a resposta de um filtro antigo que chega depois é descartada", async () => {
    let releaseOld: (response: Response) => void = () => undefined;
    const user = userEvent.setup();
    render(<WebhookDeliveries subscriptions={SUBS} />);
    await screen.findAllByRole("listitem");

    // 1ª troca de filtro fica pendurada; a 2ª responde na hora.
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseOld = resolve)));
    await user.click(screen.getByRole("combobox", { name: "Filtrar entregas por status" }));
    await user.click(await screen.findByRole("option", { name: "Entregue" }));
    listResponse = () => Response.json({ ok: true, deliveries: [] });
    await user.click(screen.getByRole("combobox", { name: "Filtrar entregas por status" }));
    await user.click(await screen.findByRole("option", { name: "Esgotada" }));
    expect(await screen.findByText("Nenhuma entrega com esses filtros.")).toBeInTheDocument();

    releaseOld(Response.json({ ok: true, deliveries: [delivery({ id: "velha" })] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Nenhuma entrega com esses filtros.")).toBeInTheDocument();
  });
});
