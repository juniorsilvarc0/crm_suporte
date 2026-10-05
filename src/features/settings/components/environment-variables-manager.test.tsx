import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

import { EnvironmentVariablesManager } from "@/features/settings/components/environment-variables-manager";
import type { EnvironmentVariableListItem, TranscriptionModelConfig } from "@/features/settings/types";

const OPENAI: EnvironmentVariableListItem = {
  id: "v1",
  name: "OPENAI_API_KEY",
  source: "vault",
  createdAt: "2026-09-30T12:00:00Z",
  updatedAt: "2026-09-30T12:00:00Z",
};
// Gravada antes do catálogo: o CRM não a lê mais.
const OLD: EnvironmentVariableListItem = {
  id: "v2",
  name: "N8N_WEBHOOK_URL",
  source: "vault",
  createdAt: "2026-08-01T12:00:00Z",
  updatedAt: "2026-08-01T12:00:00Z",
};
// As duas chaves da fonte externa de clientes, também no catálogo.
const SOURCE_URL: EnvironmentVariableListItem = {
  id: "v3",
  name: "CUSTOMER_SOURCE_URL",
  source: "vault",
  createdAt: "2026-10-05T12:00:00Z",
  updatedAt: "2026-10-05T12:00:00Z",
};
const SOURCE_TOKEN: EnvironmentVariableListItem = {
  id: "v4",
  name: "CUSTOMER_SOURCE_TOKEN",
  source: "vault",
  createdAt: "2026-10-05T12:00:00Z",
  updatedAt: "2026-10-05T12:00:00Z",
};
const DEFAULT_MODEL: TranscriptionModelConfig = { value: "whisper-1", source: "default" };

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
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => Response.json({ ok: true, message: "Variável salva." }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderManager(variables: EnvironmentVariableListItem[], model: TranscriptionModelConfig = DEFAULT_MODEL) {
  render(<EnvironmentVariablesManager variables={variables} transcriptionModel={model} />);
  return userEvent.setup();
}

const sentBody = () => JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;

describe("EnvironmentVariablesManager", () => {
  it("não mostra mais a origem: o CRM só lê do cofre", () => {
    renderManager([OPENAI]);

    expect(screen.queryByRole("columnheader", { name: "Origem" })).not.toBeInTheDocument();
    expect(screen.queryByText("Servidor")).not.toBeInTheDocument();
    expect(screen.queryByText("Sobrescrever")).not.toBeInTheDocument();
  });

  it("chave do catálogo pode ser substituída e removida", () => {
    renderManager([OPENAI]);

    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(within(row).getByRole("button", { name: "Substituir" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Remover" })).toBeInTheDocument();
  });

  it("variável antiga, fora do catálogo: diz que o CRM não a lê, e só oferece remover", () => {
    renderManager([OPENAI, OLD]);

    const row = within(screen.getByRole("table")).getAllByRole("row")[2]!;
    expect(within(row).getByText("Fora do catálogo: o CRM não lê esta chave.")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Substituir" })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Remover" })).toBeInTheDocument();
  });

  it("adicionar escolhe a chave do catálogo que falta, e grava sem substituir", async () => {
    // Só a chave da OpenAI fica faltando (as da fonte externa já estão gravadas).
    const user = renderManager([OLD, SOURCE_URL, SOURCE_TOKEN]);

    await user.click(screen.getByRole("button", { name: "Adicionar variável" }));
    // Uma só chave faltando: ela já vem escolhida, com o que ela faz.
    expect(screen.getByText("Chave da OpenAI, usada para transcrever os áudios do WhatsApp.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Novo valor"), "sk-teste");
    await user.click(screen.getByRole("button", { name: "Salvar variável" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({ name: "OPENAI_API_KEY", value: "sk-teste", replace: false });
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("com todas as chaves do catálogo já gravadas, adicionar fica desabilitado e diz por quê", () => {
    renderManager([OPENAI, SOURCE_URL, SOURCE_TOKEN]);

    expect(screen.getByRole("button", { name: "Adicionar variável" })).toBeDisabled();
    expect(screen.getByText("Todas as chaves do catálogo já têm valor.")).toBeInTheDocument();
  });

  it("substituir mantém a chave e grava com replace", async () => {
    const user = renderManager([OPENAI]);

    await user.click(screen.getAllByRole("button", { name: "Substituir" })[0]!);
    expect(screen.getByLabelText("Chave")).toHaveValue("OPENAI_API_KEY");
    expect(screen.getByLabelText("Chave")).toBeDisabled();
    await user.type(screen.getByLabelText("Novo valor"), "sk-novo");
    await user.click(screen.getByRole("button", { name: "Salvar variável" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody()).toEqual({ name: "OPENAI_API_KEY", value: "sk-novo", replace: true });
  });

  it("o modelo de transcrição diz se vem do cofre ou do padrão", () => {
    const { unmount } = render(
      <EnvironmentVariablesManager variables={[]} transcriptionModel={DEFAULT_MODEL} />
    );
    expect(screen.getByText("Padrão")).toBeInTheDocument();
    unmount();

    render(
      <EnvironmentVariablesManager variables={[]} transcriptionModel={{ value: "gpt-4o-transcribe", source: "vault" }} />
    );
    expect(screen.getByText("Cofre")).toBeInTheDocument();
  });
});
