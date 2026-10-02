import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ApiTokenEditDialog } from "@/features/settings/components/api-token-edit-dialog";
import type { ApiTokenListItem } from "@/features/settings/types";
import { AI_TRIAGE_PRESET } from "@/lib/api/v1/scopes";

const TOKEN: ApiTokenListItem = {
  id: "0b8f2c1e-6a4d-4f2b-9c1a-7d3e5f6a8b90",
  name: "n8n",
  token_prefix: "crmsuporte_ab",
  scopes: ["tickets:read", "tickets:*"],
  actor_type: "api",
  rate_limit_per_min: 120,
  expires_at: "2099-12-31T02:59:59.000Z",
  created_at: "2026-09-29T00:00:00Z",
  last_used_at: null,
  revoked_at: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>;
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

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => Response.json({ ok: true, message: "Token alterado." }));
  vi.stubGlobal("fetch", fetchMock);
  onOpenChange = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(token: ApiTokenListItem = TOKEN) {
  render(<ApiTokenEditDialog token={token} open onOpenChange={onOpenChange} />);
  return userEvent.setup();
}

const scopeBox = (label: RegExp) => screen.getByRole("checkbox", { name: label });
const save = () => screen.getByRole("button", { name: "Salvar alterações" });
const sentBody = () => JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;

describe("ApiTokenEditDialog", () => {
  it("abre com os valores do token: nome, escopos marcados, limite e validade (no fuso do app)", () => {
    open();

    expect(screen.getByRole("textbox", { name: "Nome" })).toHaveValue("n8n");
    expect(scopeBox(/\(tickets:read\)/)).toBeChecked();
    expect(scopeBox(/\(tickets:write\)/)).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "Limite por minuto" })).toHaveValue("120");
    expect(screen.getByLabelText("Validade")).toHaveValue("2099-12-30");
    expect(screen.getByText("2 escopos marcados.")).toBeInTheDocument();
  });

  it("um `recurso:*` do token continua na lista, marcado, e não some ao salvar", async () => {
    const user = open();

    expect(scopeBox(/\(tickets:\*\)/)).toBeChecked();
    await user.click(scopeBox(/\(tickets:read\)/));
    await user.click(save());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({ scopes: ["tickets:*"] });
  });

  it("salvar sem mudar nada fecha sem pedido nenhum", async () => {
    const user = open();

    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o PATCH leva só o que mudou, na rota do token", async () => {
    const user = open();
    const name = screen.getByRole("textbox", { name: "Nome" });

    await user.clear(name);
    await user.type(name, "n8n produção");
    await user.click(scopeBox(/\(tickets:write\)/));
    await user.click(save());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/api-tokens/${TOKEN.id}`);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("PATCH");
    expect(sentBody()).toEqual({ name: "n8n produção", scopes: ["tickets:read", "tickets:*", "tickets:write"] });
    expect(toastMock.success).toHaveBeenCalledWith("Token alterado.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("Aplicar IA de triagem troca escopos, tipo e limite pelos do preset", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: "Aplicar IA de triagem" }));
    await user.click(save());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({ scopes: [...AI_TRIAGE_PRESET], actor_type: "ai", rate_limit_per_min: 300 });
  });

  it("Limpar desmarca tudo e avisa que o token deixa de alcançar algo", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: "Limpar" }));

    expect(screen.getByText("Sem escopo, o token autentica mas não alcança nada.")).toBeInTheDocument();
    await user.click(save());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({ scopes: [] });
  });

  it("validade nova vale até o fim do dia no fuso do app; vazia tira a validade", async () => {
    const user = open();

    fireEvent.change(screen.getByLabelText("Validade"), { target: { value: "2099-06-15" } });
    await user.click(save());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({ expires_at: "2099-06-16T02:59:59.000Z" });
  });

  it("validade apagada vai como nula", async () => {
    const user = open();

    fireEvent.change(screen.getByLabelText("Validade"), { target: { value: "" } });
    await user.click(save());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({ expires_at: null });
  });

  it("validade mexida para o passado é recusada no campo, sem pedido", async () => {
    const user = open();

    fireEvent.change(screen.getByLabelText("Validade"), { target: { value: "2020-01-01" } });
    await user.click(save());

    expect(await screen.findByText("A validade precisa ser no futuro.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["0", "Mínimo de 1 por minuto."],
    ["9999", "Máximo de 6000 por minuto."],
    ["abc", "Informe um número de 1 a 6000."],
  ])("limite %s é recusado no campo, sem pedido", async (value, message) => {
    const user = open();
    const rate = screen.getByRole("textbox", { name: "Limite por minuto" });

    await user.clear(rate);
    await user.type(rate, value);
    await user.click(save());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token já vencido abre com a data antiga e salva outro campo sem esbarrar nela", async () => {
    const user = open({ ...TOKEN, expires_at: "2020-01-01T00:00:00Z" });

    await user.click(scopeBox(/\(tickets:write\)/));
    await user.click(save());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody()).not.toHaveProperty("expires_at");
  });

  it("erro de campo do servidor vai para o campo; erro sem campo vira alerta no topo", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ ok: false, message: "Revise os campos destacados.", errors: { expires_at: ["Data inválida."] } }, { status: 400 })
    );
    const user = open();
    fireEvent.change(screen.getByLabelText("Validade"), { target: { value: "2099-06-15" } });
    await user.click(save());

    expect(await screen.findByText("Data inválida.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, message: "Token não encontrado ou revogado." }, { status: 404 }));
    await user.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Token não encontrado ou revogado.");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sem resposta do servidor, avisa no topo e não fecha", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = open();
    await user.click(scopeBox(/\(tickets:write\)/));
    await user.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível alterar o token.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
