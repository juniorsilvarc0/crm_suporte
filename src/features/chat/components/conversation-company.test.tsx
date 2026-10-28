import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ConversationCompany } from "@/features/chat/components/conversation-company";
import type {
  CustomerContext,
  CustomerContextResult,
  CustomerContract,
} from "@/features/customer-source/types";
import type { CustomerSummary } from "@/features/customers/types";

const CUSTOMER: CustomerSummary = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  legal_name: "EMPRESA EXEMPLO LTDA",
  trade_name: "Empresa Exemplo",
  cnpj: "11222333000181",
  contract_status: null,
  archived_at: null,
};

// O número da conversa e o da pessoa na TCBX: mesmo DDD + 8 últimos dígitos.
const PHONE = "5511900000001";

function contract(id: number, sistemas: CustomerContract["sistemas"]): CustomerContract {
  return {
    id,
    numero: `CT-${id}`,
    modalidade: null,
    vigencia: null,
    dataInicio: null,
    dataFim: null,
    vencimentoDia: null,
    status: "assinado",
    statusVigencia: "ativo",
    dataAtivacao: null,
    sistemas,
  };
}

function ok(over: Partial<CustomerContext> = {}): CustomerContextResult {
  return {
    state: "ok",
    context: {
      externalId: "1",
      tipoPessoa: "PJ",
      // Com máscara, como a TCBX manda: compara com o CNPJ do nosso cadastro sem ela.
      documento: "11.222.333/0001-81",
      razaoSocial: "EMPRESA EXEMPLO LTDA",
      nomeFantasia: null,
      status: "ativo",
      emailPrincipal: null,
      emailFinanceiro: null,
      telefonePrincipal: null,
      telefoneSecundario: null,
      contratos: [
        contract(1, [{ id: 1, nome: "Sistema A (Ouro)" }]),
        contract(2, [{ id: 2, nome: "Sistema B Diamante + Extra" }]),
      ],
      titulosEmAberto: [],
      contatos: [
        { id: 1, nome: "Pessoa Teste", tipo: "dono", cargo: null, whatsapp: "11900000001", telefone: null },
      ],
      ...over,
    },
  };
}

function block() {
  return document.querySelector("[data-conversation-company]");
}

describe("ConversationCompany", () => {
  it("sem empresa ligada, não desenha nada", () => {
    const { container } = render(<ConversationCompany customer={null} context={ok()} phone={PHONE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("o nome vem do nosso cadastro e é link para a ficha, mesmo antes da TCBX responder", () => {
    render(<ConversationCompany customer={CUSTOMER} context={null} phone={PHONE} />);

    const link = screen.getByRole("link", { name: "Abrir empresa Empresa Exemplo" });
    expect(link).toHaveAttribute("href", `/app/clientes/${CUSTOMER.id}`);
    expect(link).toHaveAttribute("title", "EMPRESA EXEMPLO LTDA");
    expect(screen.queryByText(/Selo da empresa/)).toBeNull();
  });

  it("com a TCBX: os selos da empresa (do mais alto ao mais baixo) e o papel da pessoa, com texto para o leitor de tela", () => {
    render(<ConversationCompany customer={CUSTOMER} context={ok()} phone={PHONE} />);

    const seals = screen.getAllByText(/Selo da empresa:/).map((label) => label.parentElement);
    expect(seals.map((seal) => seal?.textContent)).toEqual([
      "Selo da empresa: Diamante",
      "Selo da empresa: Ouro",
    ]);
    // O title diz de onde o selo veio: o sistema contratado.
    expect(seals[1]).toHaveAttribute("title", "Sistema A (Ouro)");
    expect(screen.getByText(/Papel na empresa:/).parentElement).toHaveTextContent("Papel na empresa: Dono");
  });

  it("resposta da TCBX de OUTRA empresa (logo depois de trocar a empresa): sem selo nem papel", () => {
    render(
      <ConversationCompany customer={CUSTOMER} context={ok({ documento: "99.888.777/0001-66" })} phone={PHONE} />
    );

    expect(screen.getByRole("link", { name: "Abrir empresa Empresa Exemplo" })).toBeInTheDocument();
    expect(screen.queryByText(/Selo da empresa|Papel na empresa|Contrato ativo/)).toBeNull();
  });

  it("empresa sem CNPJ: sem selo (a TCBX foi consultada pelo telefone, não por ela)", () => {
    render(<ConversationCompany customer={{ ...CUSTOMER, cnpj: null }} context={ok()} phone={PHONE} />);

    expect(screen.queryByText(/Selo da empresa|Papel na empresa|Contrato ativo/)).toBeNull();
  });

  it("número que não está entre os contatos da TCBX: só os selos da empresa", () => {
    render(<ConversationCompany customer={CUSTOMER} context={ok()} phone="5511988887777" />);

    expect(screen.getAllByText(/Selo da empresa:/)).toHaveLength(2);
    expect(screen.queryByText(/Papel na empresa/)).toBeNull();
  });

  it.each([
    ["fora do ar", { state: "unavailable" }],
    ["desligada", { state: "not_configured" }],
    ["sem cadastro", { state: "not_found" }],
  ] as const)("TCBX %s: o nome segue, sem selo nenhum (a tela não inventa)", (_label, context) => {
    render(<ConversationCompany customer={CUSTOMER} context={context} phone={PHONE} />);

    expect(screen.getByRole("link", { name: "Abrir empresa Empresa Exemplo" })).toBeInTheDocument();
    expect(screen.queryByText(/Selo da empresa|Papel na empresa|Contrato ativo|Sem contrato/)).toBeNull();
  });

  it("selo do contrato: com contrato ativo na TCBX, 'Contrato ativo (TCBX)' (o mesmo do painel), antes dos outros", () => {
    render(<ConversationCompany customer={CUSTOMER} context={ok()} phone={PHONE} />);

    const contract = screen.getByText("Contrato ativo (TCBX)");
    expect(document.querySelector("[data-company-seals]")?.firstElementChild).toContainElement(contract);
  });

  it("selo do contrato: o contrato interno tem precedência sobre o da TCBX", () => {
    render(<ConversationCompany customer={{ ...CUSTOMER, contract_status: "suspenso" }} context={ok()} phone={PHONE} />);

    expect(screen.getByText("Contrato suspenso")).toBeInTheDocument();
    expect(screen.queryByText("Contrato ativo (TCBX)")).toBeNull();
  });

  it("selo do contrato: o interno aparece mesmo com a TCBX fora", () => {
    render(
      <ConversationCompany customer={{ ...CUSTOMER, contract_status: "ativo" }} context={{ state: "unavailable" }} phone={PHONE} />
    );

    expect(screen.getByText("Contrato ativo")).toBeInTheDocument();
  });

  it("sem contrato (nem interno nem vigente na TCBX): nenhum selo de contrato — o 'Sem contrato' do painel não vem", () => {
    const encerrado = contract(9, [{ id: 9, nome: "Sistema A (Ouro)" }]);
    render(
      <ConversationCompany
        customer={CUSTOMER}
        context={ok({ contratos: [{ ...encerrado, statusVigencia: "encerrado" }] })}
        phone={PHONE}
      />
    );

    expect(screen.queryByText(/Contrato ativo|Sem contrato/)).toBeNull();
    // Contrato que não está vigente também não qualifica o nível.
    expect(screen.queryByText(/Selo da empresa/)).toBeNull();
    // O papel da pessoa segue: ela continua sendo da empresa na TCBX.
    expect(screen.getByText(/Papel na empresa:/).parentElement).toHaveTextContent("Papel na empresa: Dono");
  });

  it("empresa arquivada aparece como tal", () => {
    render(
      <ConversationCompany
        customer={{ ...CUSTOMER, archived_at: "2026-10-01T12:00:00+00:00" }}
        context={null}
        phone={PHONE}
      />
    );

    expect(screen.getByText("Arquivada")).toBeInTheDocument();
  });

  it("só a partir de xl: no celular e na coluna estreita, nada novo no cabeçalho", () => {
    render(<ConversationCompany customer={CUSTOMER} context={null} phone={PHONE} />);

    expect(block()).toHaveClass("hidden", "xl:flex");
  });
});
