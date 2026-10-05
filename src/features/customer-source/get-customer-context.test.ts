// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({ envMock: vi.fn() }));
vi.mock("@/features/settings/lib/get-runtime-environment", () => ({
  getRuntimeEnvironmentVariable: envMock,
}));

import {
  CUSTOMER_SOURCE_TOKEN_NAME,
  CUSTOMER_SOURCE_URL_NAME,
} from "@/features/settings/types";
import { getCustomerContext } from "@/features/customer-source/get-customer-context";

const BASE = "https://intra.tcbx.com.br/api/integracoes/ia-atendimento/v1";
const TOKEN = "tcbx_ai_live_token_de_mentira";

// A resposta real da TCBX (PETECOPECAS), com os dados trocados por fictícios.
const OK_BODY = {
  success: true,
  gerado_em: "2026-10-05T11:59:20-03:00",
  integracao: { referencia: "INT-0001", nome: "IA Atendimento - SpinCode", ambiente: "producao" },
  cliente: {
    id: 33,
    tipo_pessoa: "PJ",
    documento: "12.321.030/0001-89",
    razao_social: "EMPRESA DE TESTE LTDA",
    nome_fantasia: "TESTE",
    status: "ativo",
    email_principal: null,
    email_financeiro: null,
    telefone_principal: "8699783446",
    telefone_secundario: "8699783446",
  },
  contratos: [
    {
      id: 40,
      numero: "CT-2026-000040",
      modalidade_contratacao: "normal",
      vigencia: "sazonal",
      data_inicio: "2026-02-25",
      data_fim: "2027-01-25",
      vencimento_dia: 25,
      status: "assinado",
      status_vigencia: "ativo",
      data_ativacao: "2026-06-26 16:43:15",
    },
  ],
  financeiro: {
    titulos_em_aberto: [
      {
        id: 301,
        contrato_id: 40,
        contrato_numero: "CT-2026-000040",
        numero_documento: null,
        descricao: "Mensalidade ref. CT-2026-000040 — 4/7",
        tipo: "mensalidade",
        data_emissao: "2026-06-26",
        data_vencimento: "2026-10-25",
        valor_principal: 128,
        multa_valor: 0,
        juros_valor: 0,
        situacao: "aberto",
        parcela_n: 4,
        parcela_de: 7,
      },
    ],
  },
};

const envValues = (values: Record<string, string | null>) =>
  envMock.mockImplementation(async (name: string) => ({
    value: values[name] ?? null,
    source: values[name] ? "vault" : "none",
  }));

const fetchMock = vi.fn();
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  envValues({ [CUSTOMER_SOURCE_URL_NAME]: BASE, [CUSTOMER_SOURCE_TOKEN_NAME]: TOKEN });
  fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getCustomerContext", () => {
  it("cliente achado: normaliza o contexto (id estável, contrato e títulos em aberto)", async () => {
    const result = await getCustomerContext({ documento: "12321030000189" });

    expect(result).toEqual({
      state: "ok",
      context: {
        externalId: "33",
        tipoPessoa: "PJ",
        documento: "12.321.030/0001-89",
        razaoSocial: "EMPRESA DE TESTE LTDA",
        nomeFantasia: "TESTE",
        status: "ativo",
        emailPrincipal: null,
        emailFinanceiro: null,
        telefonePrincipal: "8699783446",
        telefoneSecundario: "8699783446",
        contratos: [
          {
            id: 40,
            numero: "CT-2026-000040",
            modalidade: "normal",
            vigencia: "sazonal",
            dataInicio: "2026-02-25",
            dataFim: "2027-01-25",
            vencimentoDia: 25,
            status: "assinado",
            statusVigencia: "ativo",
            dataAtivacao: "2026-06-26 16:43:15",
          },
        ],
        titulosEmAberto: [
          {
            id: 301,
            contratoId: 40,
            contratoNumero: "CT-2026-000040",
            descricao: "Mensalidade ref. CT-2026-000040 — 4/7",
            tipo: "mensalidade",
            dataEmissao: "2026-06-26",
            dataVencimento: "2026-10-25",
            valorPrincipal: 128,
            multaValor: 0,
            jurosValor: 0,
            situacao: "aberto",
            parcelaN: 4,
            parcelaDe: 7,
          },
        ],
      },
    });
  });

  it("chama a fonte com o Bearer, sem seguir redirect, e com a chave na query", async () => {
    await getCustomerContext({ documento: "12321030000189" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/clientes/contexto?documento=12321030000189`);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
  });

  it.each([
    ["documento", { documento: "123" } as const, "documento=123"],
    ["cliente_id", { clienteId: 33 } as const, "cliente_id=33"],
    ["telefone", { telefone: "5586999783446" } as const, "telefone=5586999783446"],
  ])("monta a query por %s", async (_label, lookup, expected) => {
    await getCustomerContext(lookup);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/clientes/contexto?${expected}`);
  });

  it("contratos e títulos ausentes viram listas vazias", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, cliente: { ...OK_BODY.cliente } }));

    const result = await getCustomerContext({ clienteId: 33 });

    expect(result.state === "ok" && result.context.contratos).toEqual([]);
    expect(result.state === "ok" && result.context.titulosEmAberto).toEqual([]);
  });

  it("id numérico ou string vira sempre texto no externalId", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, cliente: { ...OK_BODY.cliente, id: "33" } }));
    const result = await getCustomerContext({ clienteId: "33" });
    expect(result.state === "ok" && result.context.externalId).toBe("33");
  });

  it("tipo de pessoa que não é PF/PJ vira nulo", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, cliente: { ...OK_BODY.cliente, tipo_pessoa: "OUTRO" } }));
    const result = await getCustomerContext({ clienteId: 33 });
    expect(result.state === "ok" && result.context.tipoPessoa).toBeNull();
  });

  describe("sem configuração", () => {
    it.each([
      ["sem URL", { [CUSTOMER_SOURCE_TOKEN_NAME]: TOKEN }],
      ["sem chave", { [CUSTOMER_SOURCE_URL_NAME]: BASE }],
      ["sem nada", {}],
    ])("%s: not_configured, e nem chama a fonte", async (_label, values) => {
      envValues(values);

      expect(await getCustomerContext({ documento: "123" })).toEqual({ state: "not_configured" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a leitura da configuração falha: unavailable (não é 'desligado')", async () => {
      envMock.mockRejectedValue(new Error("cofre indisponível"));

      expect(await getCustomerContext({ documento: "123" })).toEqual({ state: "unavailable" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("cliente inexistente: not_found", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "Cliente não encontrado." }, 404));

    expect(await getCustomerContext({ documento: "00000000000" })).toEqual({ state: "not_found" });
  });

  describe("falha vira unavailable, nunca 'sem cliente'", () => {
    it("a fonte não responde (rede)", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }));
      expect(await getCustomerContext({ documento: "123" })).toEqual({ state: "unavailable" });
    });

    it.each([401, 422, 500, 503])("status %s", async (status) => {
      fetchMock.mockResolvedValue(jsonResponse({ success: false }, status));
      expect(await getCustomerContext({ documento: "123" })).toEqual({ state: "unavailable" });
    });

    it("resposta 200 que não é JSON", async () => {
      fetchMock.mockResolvedValue(new Response("<html>erro</html>", { status: 200 }));
      expect(await getCustomerContext({ documento: "123" })).toEqual({ state: "unavailable" });
    });

    it("200 em formato inesperado (sem cliente)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));
      expect(await getCustomerContext({ documento: "123" })).toEqual({ state: "unavailable" });
    });

    it("200 com success:false não é tratado como achado", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: false, cliente: OK_BODY.cliente }));
      expect(await getCustomerContext({ documento: "123" })).toEqual({ state: "unavailable" });
    });

    it("a URL da fonte aponta para rede interna: unavailable, sem vazar a chave no log", async () => {
      // 10.0.0.0/8 é bloqueado em qualquer ambiente (localhost é liberado só em dev).
      envValues({ [CUSTOMER_SOURCE_URL_NAME]: "http://10.0.0.5/api", [CUSTOMER_SOURCE_TOKEN_NAME]: TOKEN });

      expect(await getCustomerContext({ documento: "123" })).toEqual({ state: "unavailable" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls)).not.toContain(TOKEN);
    });
  });

  it("a chave nunca aparece no log quando a fonte falha", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await getCustomerContext({ documento: "123" });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).not.toContain(TOKEN);
  });
});
