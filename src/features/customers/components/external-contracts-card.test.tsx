import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExternalContractsCard } from "@/features/customers/components/external-contracts-card";
import type { StoredExternalContract } from "@/features/customers/types";

const { refreshMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: successMock, error: errorMock } }));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function contract(overrides: Partial<StoredExternalContract>): StoredExternalContract {
  return {
    id: "ec1",
    externalId: "261",
    numero: "CT-2026-000261",
    modalidade: "Suporte mensal",
    status: "assinado",
    statusVigencia: "ativo",
    dataInicio: "2026-01-15",
    dataFim: null,
    vencimentoDia: 10,
    dataAtivacao: "2026-01-15",
    syncedAt: "2026-10-07T23:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  successMock.mockReset();
  errorMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExternalContractsCard", () => {
  it("não renderiza quando não há contrato espelhado e não pode sincronizar", () => {
    render(<ExternalContractsCard customerId="c1" contracts={[]} canSync={false} />);
    expect(screen.queryByText("Contratos (TCBX)")).not.toBeInTheDocument();
  });

  it("lista os contratos com a situação e a data de sincronização", () => {
    render(
      <ExternalContractsCard
        customerId="c1"
        canSync={false}
        contracts={[
          contract({ id: "a", numero: "CT-1", statusVigencia: "ativo" }),
          contract({ id: "b", numero: "CT-2", status: "encerrado", statusVigencia: "encerrado" }),
        ]}
      />
    );
    expect(screen.getByText("Contratos (TCBX)")).toBeInTheDocument();
    expect(screen.getByText("Contrato CT-1")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Contrato CT-2")).toBeInTheDocument();
    expect(screen.getByText("encerrado")).toBeInTheDocument();
    expect(screen.getByText(/Atualizado da TCBX em/)).toBeInTheDocument();
    // Member não vê o botão de sincronizar.
    expect(screen.queryByRole("button", { name: "Atualizar da TCBX" })).not.toBeInTheDocument();
  });

  it("admin sem contrato vê o aviso e o botão de atualizar", () => {
    render(<ExternalContractsCard customerId="c1" contracts={[]} canSync />);
    expect(screen.getByText("Contratos (TCBX)")).toBeInTheDocument();
    expect(screen.getByText("Nenhum contrato da TCBX para esta empresa.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar da TCBX" })).toBeInTheDocument();
  });

  it("atualizar da TCBX chama a rota e recarrega quando dá certo", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: { state: "ok" } }));
    render(<ExternalContractsCard customerId="c1" contracts={[]} canSync />);

    await userEvent.click(screen.getByRole("button", { name: "Atualizar da TCBX" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/customers/c1/sync-contracts", { method: "POST" })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(successMock).toHaveBeenCalled();
  });

  it("atualizar avisa e NÃO recarrega quando a integração está desligada", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: { state: "not_configured" } }));
    render(<ExternalContractsCard customerId="c1" contracts={[]} canSync />);

    await userEvent.click(screen.getByRole("button", { name: "Atualizar da TCBX" }));

    await waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
