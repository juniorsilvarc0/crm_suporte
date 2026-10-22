import { describe, expect, it } from "vitest";

import {
  contactRole,
  financialSituation,
  invoiceTotal,
  phoneKey,
} from "@/features/customer-source/financial";
import type { CustomerContext, CustomerOpenInvoice } from "@/features/customer-source/types";

const base: CustomerContext = {
  externalId: "33",
  tipoPessoa: "PJ",
  documento: "12321030000189",
  razaoSocial: "EMPRESA LTDA",
  nomeFantasia: "EMPRESA",
  status: "ativo",
  emailPrincipal: null,
  emailFinanceiro: null,
  telefonePrincipal: null,
  telefoneSecundario: null,
  contratos: [],
  titulosEmAberto: [],
  contatos: [],
};

const invoice = (id: number, due: string | null, over: Partial<CustomerOpenInvoice> = {}): CustomerOpenInvoice => ({
  id,
  contratoId: 40,
  contratoNumero: "CT-1",
  descricao: "Mensalidade",
  tipo: "mensalidade",
  dataEmissao: null,
  dataVencimento: due,
  valorPrincipal: 199,
  multaValor: 0,
  jurosValor: 0,
  situacao: "aberto",
  parcelaN: null,
  parcelaDe: null,
  ...over,
});

const TODAY = "2026-10-22";

describe("financialSituation", () => {
  it("vencido é o que venceu ANTES de hoje; o do dia ainda está a vencer", () => {
    const situation = financialSituation(
      {
        ...base,
        titulosEmAberto: [
          invoice(1, "2026-10-22"),
          invoice(2, "2026-10-05", { multaValor: 3.98, jurosValor: 1.2 }),
          invoice(3, "2026-09-05"),
          invoice(4, "2026-11-05"),
          invoice(5, null),
        ],
      },
      TODAY
    );

    expect(situation.overdue.map((i) => i.id)).toEqual([3, 2]);
    expect(situation.upcoming.map((i) => i.id)).toEqual([1, 4, 5]);
    expect(situation.oldestOverdue).toBe("2026-09-05");
    expect(situation.nextDue).toBe("2026-10-22");
    expect(situation.totalOverdue).toBeCloseTo(199 + 199 + 3.98 + 1.2);
    expect(situation.totalUpcoming).toBeCloseTo(199 * 3);
  });

  it("vencimento com hora compara pelo dia; sem títulos, nada vencido", () => {
    const withTime = financialSituation({ ...base, titulosEmAberto: [invoice(1, "2026-10-21T23:00:00")] }, TODAY);
    expect(withTime.overdue).toHaveLength(1);
    expect(withTime.oldestOverdue).toBe("2026-10-21");

    const empty = financialSituation(base, TODAY);
    expect(empty).toMatchObject({ overdue: [], upcoming: [], totalOverdue: 0, oldestOverdue: null, nextDue: null });
  });

  it("o total do título soma principal, multa e juros (nulo conta zero)", () => {
    expect(invoiceTotal(invoice(1, null, { valorPrincipal: 100, multaValor: 2, jurosValor: null }))).toBe(102);
  });
});

describe("contactRole (o selo da pessoa)", () => {
  const context: CustomerContext = {
    ...base,
    contatos: [
      { id: 1, nome: "Ana", tipo: "dono", cargo: null, whatsapp: "5586999784625", telefone: null },
      { id: 2, nome: "Bia", tipo: "financeiro", cargo: null, whatsapp: null, telefone: "(86) 3222-1111" },
    ],
  };

  it("acha pelo WhatsApp com ou sem o 55 e com ou sem o 9", () => {
    expect(contactRole(context, "5586999784625")).toBe("dono");
    expect(contactRole(context, "558699784625")).toBe("dono");
    expect(contactRole(context, "86999784625")).toBe("dono");
  });

  it("acha pelo telefone fixo; número fora da lista é null", () => {
    expect(contactRole(context, "558632221111")).toBe("financeiro");
    expect(contactRole(context, "5511999990000")).toBeNull();
    expect(contactRole(context, null)).toBeNull();
    expect(contactRole(context, "123")).toBeNull();
  });

  it("a chave do telefone é DDD + 8 últimos dígitos", () => {
    expect(phoneKey("+55 (86) 99978-4625")).toBe("8699784625");
    expect(phoneKey("8699784625")).toBe("8699784625");
    expect(phoneKey("99784625")).toBeNull();
  });
});
