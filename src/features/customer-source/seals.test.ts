import { describe, expect, it } from "vitest";

import { companySeals, contactRoleLabel, sealFromSystemName } from "@/features/customer-source/seals";
import type { CustomerContext, CustomerContract } from "@/features/customer-source/types";

function contract(over: Partial<CustomerContract> = {}): CustomerContract {
  return {
    id: 1,
    numero: "CT-1",
    modalidade: "normal",
    vigencia: "sazonal",
    dataInicio: null,
    dataFim: null,
    vencimentoDia: 10,
    status: "assinado",
    statusVigencia: "ativo",
    dataAtivacao: null,
    sistemas: [],
    ...over,
  };
}

function context(contratos: CustomerContract[]): CustomerContext {
  return {
    externalId: "1",
    tipoPessoa: "PJ",
    documento: null,
    razaoSocial: "Empresa de Teste",
    nomeFantasia: null,
    status: "ativo",
    emailPrincipal: null,
    emailFinanceiro: null,
    telefonePrincipal: null,
    telefoneSecundario: null,
    contratos,
    titulosEmAberto: [],
    contatos: [],
  };
}

describe("sealFromSystemName", () => {
  it("nível no fim, entre parênteses", () => {
    expect(sealFromSystemName("Sistema X (Ouro)")).toEqual({ label: "Ouro", tone: "ouro" });
    expect(sealFromSystemName("Sistema X (Diamante)")).toEqual({ label: "Diamante", tone: "diamante" });
  });

  it("nível no meio do nome, sem parênteses (a TCBX também escreve assim)", () => {
    expect(sealFromSystemName("Sistema X Diamante [Gestão]")).toEqual({ label: "Diamante", tone: "diamante" });
    expect(sealFromSystemName("Sistema Y Diamante + Hotel")).toEqual({ label: "Diamante", tone: "diamante" });
  });

  it("outro rótulo entre parênteses aparece como veio; sem selo é null", () => {
    expect(sealFromSystemName("Sistema X (MEI)")).toEqual({ label: "MEI", tone: "outro" });
    expect(sealFromSystemName("Sistema Z")).toBeNull();
    expect(sealFromSystemName("Sistema antigo")).toBeNull();
    expect(sealFromSystemName(null)).toBeNull();
  });

  it("nível só como palavra inteira: 'Ouroboros' não é Ouro", () => {
    expect(sealFromSystemName("Ouroboros Gestão")).toBeNull();
  });
});

describe("companySeals", () => {
  it("um selo por rótulo, do mais alto para o mais baixo, com os sistemas que o trazem", () => {
    const seals = companySeals(
      context([
        contract({ id: 1, sistemas: [{ id: 1, nome: "Sistema X (Ouro)" }, { id: 2, nome: "Sistema Z" }] }),
        contract({ id: 2, sistemas: [{ id: 3, nome: "Sistema Y Diamante + Hotel" }, { id: 4, nome: "Outro (MEI)" }] }),
        contract({ id: 3, sistemas: [{ id: 5, nome: "Sistema X (Ouro)" }] }),
      ])
    );
    expect(seals).toEqual([
      { label: "Diamante", tone: "diamante", systems: ["Sistema Y Diamante + Hotel"] },
      { label: "Ouro", tone: "ouro", systems: ["Sistema X (Ouro)"] },
      { label: "MEI", tone: "outro", systems: ["Outro (MEI)"] },
    ]);
  });

  it("contrato que não está vigente não qualifica o cliente", () => {
    const seals = companySeals(
      context([contract({ statusVigencia: "encerrado", sistemas: [{ id: 1, nome: "Sistema X (Ouro)" }] })])
    );
    expect(seals).toEqual([]);
  });

  it("sem contrato ou sem sistema com selo: nenhum selo", () => {
    expect(companySeals(context([]))).toEqual([]);
    expect(companySeals(context([contract({ sistemas: [{ id: 1, nome: "Sistema Z" }] })]))).toEqual([]);
  });

  it("contrato sem `sistemas` (resposta da versão anterior, na troca rolante): nenhum selo, sem quebrar", () => {
    const legacy = { ...contract(), sistemas: undefined } as unknown as CustomerContract;
    expect(companySeals(context([legacy]))).toEqual([]);
  });
});

describe("contactRoleLabel", () => {
  it("os papéis da TCBX em português; o desconhecido aparece como veio", () => {
    expect(contactRoleLabel("dono")).toBe("Dono");
    expect(contactRoleLabel(" Financeiro ")).toBe("Financeiro");
    expect(contactRoleLabel("operacional")).toBe("Operacional");
    expect(contactRoleLabel("gerente")).toBe("Gerente");
    expect(contactRoleLabel("outro")).toBe("Outro");
    expect(contactRoleLabel("sócio")).toBe("Sócio");
  });
});
