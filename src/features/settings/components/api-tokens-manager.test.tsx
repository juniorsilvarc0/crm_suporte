import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ApiTokensManager } from "@/features/settings/components/api-tokens-manager";
import type { ApiTokenListItem } from "@/features/settings/types";
import { AI_TRIAGE_PRESET } from "@/lib/api/v1/scopes";

function token(over: Partial<ApiTokenListItem>): ApiTokenListItem {
  return {
    id: "t",
    name: "Token",
    token_prefix: "crmsuporte_a",
    scopes: [],
    actor_type: "api",
    rate_limit_per_min: 120,
    expires_at: null,
    created_at: "2026-09-29T00:00:00Z",
    last_used_at: null,
    revoked_at: null,
    ...over,
  };
}

const TOKENS = [
  token({ id: "1", name: "Agente Ticbox", scopes: [...AI_TRIAGE_PRESET], actor_type: "ai" }),
  token({ id: "2", name: "n8n antigo" }),
  token({ id: "3", name: "Token velho", scopes: ["tickets:read"], expires_at: "2020-01-01T00:00:00Z" }),
];

let fetchMock: ReturnType<typeof vi.fn>;
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
  fetchMock = vi.fn(async () =>
    Response.json({ ok: true, token: "crmsuporte_segredo", item: TOKENS[0], message: "Token gerado." })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ApiTokensManager", () => {
  it("mostra o acesso de cada token e o vencido como Vencido", () => {
    render(<ApiTokensManager tokens={TOKENS} />);

    const rows = screen.getAllByRole("row");
    const row = (name: string) => rows.find((r) => within(r).queryByText(name)) as HTMLElement;
    expect(within(row("Agente Ticbox")).getByText("IA de triagem")).toBeTruthy();
    expect(within(row("n8n antigo")).getByText("Sem escopo")).toBeTruthy();
    expect(within(row("Token velho")).getByText("1 escopo")).toBeTruthy();
    expect(within(row("Token velho")).getByText("Vencido")).toBeTruthy();
    expect(within(row("Agente Ticbox")).getByText("Ativo")).toBeTruthy();
  });

  it("o filtro Ativos deixa o vencido de fora, e Vencidos mostra só ele", async () => {
    const user = userEvent.setup();
    render(<ApiTokensManager tokens={TOKENS} />);
    const filter = async (label: string) => {
      await user.click(screen.getByRole("button", { name: /^Filtros/ }));
      await user.click(screen.getByRole("combobox", { name: "Filtrar tokens por status" }));
      await user.click(await screen.findByRole("option", { name: label }));
      await user.keyboard("{Escape}");
    };

    await filter("Ativos");
    expect(screen.queryAllByText("Token velho")).toHaveLength(0);
    expect(screen.getAllByText("Agente Ticbox").length).toBeGreaterThan(0);

    await filter("Vencidos");
    expect(screen.getAllByText("Token velho").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Agente Ticbox")).toHaveLength(0);
  });

  it("sem escolher, gera token sem acesso", async () => {
    const user = userEvent.setup();
    render(<ApiTokensManager tokens={[]} />);

    await user.click(screen.getByRole("button", { name: "Gerar token" }));
    await user.type(screen.getByLabelText("Nome"), "n8n produção");
    await user.click(screen.getAllByRole("button", { name: "Gerar token" }).at(-1) as HTMLElement);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ name: "n8n produção", scopes: [], actor_type: "api", rate_limit_per_min: 120 });
  });

  it("IA de triagem gera o token com os escopos do agente, tipo ai e 300/min", async () => {
    const user = userEvent.setup();
    render(<ApiTokensManager tokens={[]} />);

    await user.click(screen.getByRole("button", { name: "Gerar token" }));
    await user.type(screen.getByLabelText("Nome"), "Agente Ticbox");
    await user.click(screen.getByRole("combobox", { name: "Acesso" }));
    await user.click(await screen.findByRole("option", { name: /IA de triagem/ }));
    await user.click(screen.getAllByRole("button", { name: "Gerar token" }).at(-1) as HTMLElement);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({
      name: "Agente Ticbox",
      scopes: [...AI_TRIAGE_PRESET],
      actor_type: "ai",
      rate_limit_per_min: 300,
    });
  });

  it("Editar abre o formulário do token da linha; token revogado não tem Editar", async () => {
    const user = userEvent.setup();
    render(
      <ApiTokensManager
        tokens={[...TOKENS, token({ id: "4", name: "Revogado", revoked_at: "2026-09-30T00:00:00Z" })]}
      />
    );

    expect(screen.queryAllByRole("button", { name: "Editar o token Revogado" })).toHaveLength(0);
    // Vencido ainda se edita: é como se estende a validade.
    expect(screen.getAllByRole("button", { name: "Editar o token Token velho" }).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "Editar o token n8n antigo" })[0]!);

    expect(await screen.findByRole("heading", { name: "Editar token" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nome" })).toHaveValue("n8n antigo");
  });
});
