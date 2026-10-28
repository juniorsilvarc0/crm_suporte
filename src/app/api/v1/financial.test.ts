// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, byDocumentMock, byPhoneMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  byDocumentMock: vi.fn(),
  byPhoneMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));
vi.mock("@/features/customer-source/get-customer-context", () => ({ getCustomerContext: byDocumentMock }));
vi.mock("@/features/customer-source/resolve-by-phone", () => ({ resolveCustomerByPhone: byPhoneMock }));

import { GET as financial } from "@/app/api/v1/contacts/[id]/financial/route";
import type { CustomerContext, CustomerOpenInvoice } from "@/features/customer-source/types";
import { itemOf } from "@/lib/api/v1/cadastros";
import { contactFinancialSchema } from "@/lib/api/v1/financial";

import { createHarness } from "./test-harness";

// A situação financeira do cliente para a IA (v1). A consulta à TCBX tem testes
// próprios (customer-source); aqui se confere a resolução (CNPJ da empresa, senão
// telefone), os selos, a separação vencido × a vencer e os erros.

const CONTACT = "1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
const CUSTOMER = "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
const PHONE = "558699784625";

const invoice = (id: number, due: string, principal = 199, fine = 0): CustomerOpenInvoice => ({
  id,
  contratoId: 40,
  contratoNumero: "CT-40",
  descricao: `Mensalidade ${id}`,
  tipo: "mensalidade",
  dataEmissao: null,
  dataVencimento: due,
  valorPrincipal: principal,
  multaValor: fine,
  jurosValor: 0,
  situacao: "aberto",
  parcelaN: id,
  parcelaDe: 12,
});

const context = (over: Partial<CustomerContext> = {}): CustomerContext => ({
  externalId: "33",
  tipoPessoa: "PJ",
  documento: "12321030000189",
  razaoSocial: "PADARIA SAO JOAO LTDA",
  nomeFantasia: "Padaria São João",
  status: "ativo",
  emailPrincipal: null,
  emailFinanceiro: null,
  telefonePrincipal: null,
  telefoneSecundario: null,
  contratos: [
    {
      id: 40,
      numero: "CT-40",
      modalidade: null,
      vigencia: null,
      dataInicio: null,
      dataFim: null,
      vencimentoDia: 5,
      status: "assinado",
      statusVigencia: "ativo",
      dataAtivacao: null,
      sistemas: [],
    },
  ],
  titulosEmAberto: [invoice(2, "2026-10-05", 199, 3.98), invoice(3, "2026-11-05"), invoice(1, "2026-09-05")],
  contatos: [{ id: 7, nome: "Ana", tipo: "dono", cargo: null, whatsapp: "5586999784625", telefone: null }],
  ...over,
});

const h = createHarness(adminClientMock);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T15:00:00Z"));
  h.reset(["financial:read"]);
  h.tables.contacts = () => ({ data: { phone: PHONE, customer_id: CUSTOMER }, error: null });
  h.tables.customers = () => ({
    data: { cnpj: "12321030000189", legal_name: "PADARIA SAO JOAO LTDA", trade_name: "Padaria São João", contract_status: null },
    error: null,
  });
  byDocumentMock.mockResolvedValue({ state: "ok", context: context() });
  byPhoneMock.mockResolvedValue({ state: "ok", context: context() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const call = (id = CONTACT) => (financial as Handler)(h.request("/x"), { params: Promise.resolve({ id }) });
const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

describe("GET /api/v1/contacts/{id}/financial", () => {
  it("empresa com CNPJ: consulta pelo documento e separa vencidos e a vencer, no schema publicado", async () => {
    const response = await call();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(byDocumentMock).toHaveBeenCalledWith({ documento: "12321030000189" });
    expect(byPhoneMock).not.toHaveBeenCalled();
    const data = itemOf(contactFinancialSchema).parse(payload).data;
    expect(data).toMatchObject({
      found: true,
      not_found_reason: null,
      document: "12321030000189",
      trade_name: "Padaria São João",
      client_status: "ativo",
      company_badge: "ativo_tcbx",
      company_badge_label: "Contrato ativo (TCBX)",
      contact_role: "dono",
      overdue: true,
      total_overdue: 401.98,
      total_upcoming: 199,
      oldest_overdue_date: "2026-09-05",
    });
    expect(data.invoices_overdue.map((i) => [i.id, i.due_date, i.amount, i.installment])).toEqual([
      [1, "2026-09-05", 199, "1/12"],
      [2, "2026-10-05", 202.98, "2/12"],
    ]);
    expect(data.invoices_upcoming.map((i) => i.id)).toEqual([3]);
  });

  it("o contrato interno vence o da TCBX no selo da empresa", async () => {
    h.tables.customers = () => ({
      data: { cnpj: "12321030000189", legal_name: "X", trade_name: null, contract_status: "suspenso" },
      error: null,
    });

    const data = (await (await call()).json()).data;

    expect(data).toMatchObject({ company_badge: "suspenso", company_badge_label: "Contrato suspenso" });
  });

  it("contato sem empresa: resolve pelo telefone", async () => {
    h.tables.contacts = () => ({ data: { phone: PHONE, customer_id: null }, error: null });

    const data = (await (await call()).json()).data;

    expect(byPhoneMock).toHaveBeenCalledWith(PHONE);
    expect(byDocumentMock).not.toHaveBeenCalled();
    expect(data).toMatchObject({ found: true, company_badge: "ativo_tcbx", contact_role: "dono" });
  });

  it("em dia: overdue false e nenhum vencido", async () => {
    byDocumentMock.mockResolvedValue({ state: "ok", context: context({ titulosEmAberto: [invoice(3, "2026-11-05")] }) });

    const data = (await (await call()).json()).data;

    expect(data).toMatchObject({ overdue: false, invoices_overdue: [], total_overdue: 0, oldest_overdue_date: null });
  });

  it("sem cadastro na TCBX: found false, com o CNPJ e o nome da empresa do CRM", async () => {
    byDocumentMock.mockResolvedValue({ state: "not_found" });

    const data = (await (await call()).json()).data;

    expect(data).toMatchObject({
      found: false,
      not_found_reason: "not_found",
      document: "12321030000189",
      trade_name: "Padaria São João",
      company_badge: "sem_contrato",
      contact_role: null,
      overdue: false,
    });
  });

  it("sem empresa e sem cadastro (telefone ambíguo): sem_empresa", async () => {
    h.tables.contacts = () => ({ data: { phone: PHONE, customer_id: null }, error: null });
    byPhoneMock.mockResolvedValue({ state: "ambiguous" });

    const data = (await (await call()).json()).data;

    expect(data).toMatchObject({ found: false, not_found_reason: "ambiguous", company_badge: "sem_empresa", document: null });
  });

  it("integração desligada: 503 source_not_configured; TCBX fora: 503 unavailable", async () => {
    byDocumentMock.mockResolvedValue({ state: "not_configured" });
    let response = await call();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("source_not_configured");

    byDocumentMock.mockResolvedValue({ state: "unavailable" });
    response = await call();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("unavailable");
  });

  it("contato inexistente ou id que não é UUID: 404 sem consultar a TCBX", async () => {
    h.tables.contacts = () => ({ data: null, error: null });
    expect((await call()).status).toBe(404);
    expect((await call("x")).status).toBe(404);
    expect(byDocumentMock).not.toHaveBeenCalled();
  });

  it("leitura do contato que falha: 503, sem consultar a TCBX", async () => {
    silence();
    h.tables.contacts = () => ({ data: null, error: { code: "08006", message: "conexão caiu" } });

    expect((await call()).status).toBe(503);
    expect(byDocumentMock).not.toHaveBeenCalled();
  });

  it("sem o escopo financial:read: 403 sem ler nada", async () => {
    h.scopes = ["customers:read", "contacts:read"];

    expect((await call()).status).toBe(403);
    expect(byDocumentMock).not.toHaveBeenCalled();
  });
});
