import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExternalContractsCard } from "@/features/customers/components/external-contracts-card";
import type {
  CustomerContext,
  CustomerContextResult,
} from "@/features/customer-source/types";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function context(contratos: CustomerContext["contratos"]): CustomerContext {
  return {
    externalId: "33",
    tipoPessoa: "PJ",
    documento: "12321030000189",
    razaoSocial: "Peteco Peças",
    nomeFantasia: null,
    status: "ativo",
    emailPrincipal: null,
    emailFinanceiro: null,
    telefonePrincipal: null,
    telefoneSecundario: null,
    contratos,
    titulosEmAberto: [],
  };
}

function result(body: CustomerContextResult): void {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: body }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExternalContractsCard", () => {
  it("não consulta nem renderiza quando a empresa não tem CNPJ", () => {
    render(<ExternalContractsCard customerId="c1" hasCnpj={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Contratos (TCBX)")).not.toBeInTheDocument();
  });

  it("some por completo quando a integração está desligada", async () => {
    result({ state: "not_configured" });
    render(<ExternalContractsCard customerId="c1" hasCnpj />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/customers/c1/external-context"));
    expect(screen.queryByText("Contratos (TCBX)")).not.toBeInTheDocument();
  });

  it("lista só os contratos ativos, com número, período e vencimento", async () => {
    result({
      state: "ok",
      context: context([
        {
          id: 1,
          numero: "0001",
          modalidade: "Suporte mensal",
          vigencia: null,
          dataInicio: "2026-01-15",
          dataFim: null,
          vencimentoDia: 10,
          status: "assinado",
          statusVigencia: "ativo",
          dataAtivacao: "2026-01-15",
        },
        {
          id: 2,
          numero: "0002",
          modalidade: "Antigo",
          vigencia: null,
          dataInicio: "2020-01-01",
          dataFim: "2021-01-01",
          vencimentoDia: null,
          status: "encerrado",
          statusVigencia: "encerrado",
          dataAtivacao: null,
        },
      ]),
    });
    render(<ExternalContractsCard customerId="c1" hasCnpj />);

    expect(await screen.findByText("Contrato 0001")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Suporte mensal")).toBeInTheDocument();
    expect(screen.getByText("Vencimento: dia 10")).toBeInTheDocument();
    // O contrato encerrado não entra.
    expect(screen.queryByText("Contrato 0002")).not.toBeInTheDocument();
  });

  it("avisa quando há cadastro mas nenhum contrato ativo", async () => {
    result({
      state: "ok",
      context: context([
        {
          id: 3,
          numero: "0003",
          modalidade: null,
          vigencia: null,
          dataInicio: null,
          dataFim: null,
          vencimentoDia: null,
          status: "encerrado",
          statusVigencia: "encerrado",
          dataAtivacao: null,
        },
      ]),
    });
    render(<ExternalContractsCard customerId="c1" hasCnpj />);
    expect(await screen.findByText("Nenhum contrato ativo na TCBX.")).toBeInTheDocument();
  });

  it("mostra 'sem cadastro' quando a TCBX não acha a empresa", async () => {
    result({ state: "not_found" });
    render(<ExternalContractsCard customerId="c1" hasCnpj />);
    expect(await screen.findByText("Sem cadastro na TCBX.")).toBeInTheDocument();
  });

  it("mostra indisponível com 'Tentar de novo' e reconsulta ao clicar", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false }, 500));
    render(<ExternalContractsCard customerId="c1" hasCnpj />);

    const retry = await screen.findByRole("button", { name: "Tentar de novo" });
    expect(screen.getByText("Não foi possível consultar a TCBX.")).toBeInTheDocument();

    result({ state: "not_found" });
    await userEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Sem cadastro na TCBX.")).toBeInTheDocument();
  });
});
