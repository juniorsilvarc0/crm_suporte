import { describe, expect, it } from "vitest";

import { summarizeCustomerContext } from "@/features/customer-source/summarize";
import type { CustomerContext } from "@/features/customer-source/types";

const base: CustomerContext = {
  externalId: "33",
  tipoPessoa: "PJ",
  documento: "12.321.030/0001-89",
  razaoSocial: "EMPRESA LTDA",
  nomeFantasia: "EMPRESA",
  status: "ativo",
  emailPrincipal: null,
  emailFinanceiro: null,
  telefonePrincipal: null,
  telefoneSecundario: null,
  contratos: [],
  titulosEmAberto: [],
};

const invoice = (over: Partial<CustomerContext["titulosEmAberto"][number]>): CustomerContext["titulosEmAberto"][number] => ({
  id: 1,
  contratoId: 40,
  contratoNumero: "CT-1",
  descricao: null,
  tipo: "mensalidade",
  dataEmissao: null,
  dataVencimento: null,
  valorPrincipal: 0,
  multaValor: 0,
  jurosValor: 0,
  situacao: "aberto",
  parcelaN: null,
  parcelaDe: null,
  ...over,
});

const contract = (over: Partial<CustomerContext["contratos"][number]>): CustomerContext["contratos"][number] => ({
  id: 40,
  numero: "CT-1",
  modalidade: null,
  vigencia: null,
  dataInicio: null,
  dataFim: null,
  vencimentoDia: null,
  status: null,
  statusVigencia: null,
  dataAtivacao: null,
  ...over,
});

describe("summarizeCustomerContext", () => {
  it("soma principal + multa + juros dos títulos em aberto", () => {
    const summary = summarizeCustomerContext({
      ...base,
      titulosEmAberto: [
        invoice({ id: 1, valorPrincipal: 128, multaValor: 2, jurosValor: 1 }),
        invoice({ id: 2, valorPrincipal: 128 }),
      ],
    });

    expect(summary.quantidadeEmAberto).toBe(2);
    expect(summary.totalEmAberto).toBe(259);
  });

  it("escolhe o vencimento mais próximo entre os títulos em aberto", () => {
    const summary = summarizeCustomerContext({
      ...base,
      titulosEmAberto: [
        invoice({ id: 1, dataVencimento: "2026-12-25" }),
        invoice({ id: 2, dataVencimento: "2026-10-25" }),
        invoice({ id: 3, dataVencimento: null }),
      ],
    });

    expect(summary.proximoVencimento).toBe("2026-10-25");
  });

  it("sem títulos: zero, sem vencimento", () => {
    const summary = summarizeCustomerContext(base);
    expect(summary).toMatchObject({ quantidadeEmAberto: 0, totalEmAberto: 0, proximoVencimento: null });
  });

  it("um contrato: traz o status de vigência (ou o status)", () => {
    expect(summarizeCustomerContext({ ...base, contratos: [contract({ statusVigencia: "ativo" })] })).toMatchObject({
      contratoCount: 1,
      contratoStatus: "ativo",
    });
    expect(
      summarizeCustomerContext({ ...base, contratos: [contract({ statusVigencia: null, status: "assinado" })] })
    ).toMatchObject({ contratoStatus: "assinado" });
  });

  it("mais de um contrato: conta, sem eleger um status", () => {
    const summary = summarizeCustomerContext({
      ...base,
      contratos: [contract({ id: 1 }), contract({ id: 2 })],
    });
    expect(summary).toMatchObject({ contratoCount: 2, contratoStatus: null });
  });

  it("repassa a situação do cliente", () => {
    expect(summarizeCustomerContext({ ...base, status: "inadimplente" }).situacao).toBe("inadimplente");
  });
});
