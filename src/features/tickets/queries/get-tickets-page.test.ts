import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import {
  getTicketsPage,
  parseTicketListParams,
  TICKET_LIST_SELECT,
  toTicketListItem,
} from "@/features/tickets/queries/get-tickets-page";
import type { TicketListParams } from "@/features/tickets/types";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado. Não tem `.or()`: se a busca um dia montar um, o teste quebra.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "ilike", "eq", "neq", "is", "not", "order", "range", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

function queueQueries(...results: unknown[]) {
  const queries = results.map(fakeQuery);
  for (const query of queries) fromMock.mockReturnValueOnce(query.builder);
  return queries.map((query) => query.calls);
}

const VIEWER = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";
const OTHER_USER = "8f14e45f-ceea-4e67-a3b1-9c0d1e2f3a4b";
const PRODUCT = "c9f0f895-fb98-4b91-b6c4-2d3e4f5a6b7c";
const NOW = new Date("2026-09-25T15:00:00.000Z");

// Como o PostgREST entrega a linha da view: instantes crus com microssegundos.
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  number: 1024,
  title: "Erro ao emitir nota fiscal",
  status: "em_atendimento",
  priority: "alta",
  version: 3,
  source: "agent",
  conversation_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  is_terminal: false,
  reopened_count: 0,
  sla_mode: "running",
  sla_first_response_minutes: 60,
  sla_resolution_minutes: 480,
  sla_warn_pct: 80,
  first_response_due_at: "2026-09-25T13:00:00.123456+00:00",
  resolution_due_at: "2026-09-25T20:00:00.123456+00:00",
  first_responded_at: "2026-09-25T12:10:00.654321+00:00",
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: "2026-09-25T20:00:00.123456+00:00",
  last_inbound_at: "2026-09-25T12:05:00.000001+00:00",
  created_at: "2026-09-25T12:00:00.123456+00:00",
  updated_at: "2026-09-25T12:30:00.5+00:00",
  customer: {
    id: "a1",
    legal_name: "Padaria S. João Ltda",
    trade_name: "Padaria São João",
    contract_status: "ativo",
  },
  contact: { id: "p1", name: "Maria Souza", phone: "5527999990000" },
  product: { id: PRODUCT, name: "ERP", color: "sky" },
  assignee: { id: VIEWER, name: "Ana", avatar_color: "violet", avatar_url: null },
  ...overrides,
});

const params = (overrides: Partial<TicketListParams> = {}): TicketListParams => ({
  q: "",
  status: "ativos",
  prioridade: null,
  fila: null,
  responsavel: null,
  sla: null,
  ordem: "prazo",
  page: 1,
  ...overrides,
});

const ok = (data: unknown[], count = data.length) => ({ data, error: null, count });

// Só os filtros, na ordem em que a query os aplica.
const filters = (calls: Call[]) =>
  calls.filter(([method]) => ["eq", "neq", "is", "not", "ilike"].includes(method));

const BY_DUE: Call[] = [
  ["order", "next_due_at", { ascending: true, nullsFirst: false }],
  ["order", "priority_rank", { ascending: false }],
  ["order", "number", { ascending: true }],
];

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseTicketListParams", () => {
  it("sem nada na URL: ativos, por prazo, página 1, sem filtros", () => {
    expect(parseTicketListParams({})).toEqual(params());
  });

  it("status aceita os grupos e as chaves; o resto vira 'ativos'", () => {
    for (const status of ["ativos", "resolvidos", "encerrados", "todos", "novo", "cancelado"]) {
      expect(parseTicketListParams({ status }).status).toBe(status);
    }
    for (const status of ["", "Novo", "ATIVOS", "constructor", "__proto__", "toString", undefined]) {
      expect(parseTicketListParams({ status }).status).toBe("ativos");
    }
  });

  it("prioridade, sla e ordem só pela allowlist", () => {
    expect(parseTicketListParams({ prioridade: "critica", sla: "risco", ordem: "recentes" })).toMatchObject({
      prioridade: "critica",
      sla: "risco",
      ordem: "recentes",
    });
    for (const value of ["", "média", "Alta", "toString", "estourado,risco"]) {
      expect(parseTicketListParams({ prioridade: value, sla: value, ordem: value })).toMatchObject({
        prioridade: null,
        sla: null,
        ordem: "prazo",
      });
    }
  });

  it("fila é 'sem' ou uuid (em minúsculas); o resto é ignorado", () => {
    expect(parseTicketListParams({ fila: "sem" }).fila).toBe("sem");
    expect(parseTicketListParams({ fila: PRODUCT.toUpperCase() }).fila).toBe(PRODUCT);
    for (const fila of ["SEM", "erp", `${PRODUCT},x`, `{${PRODUCT}}`, `${PRODUCT}\n`, ""]) {
      expect(parseTicketListParams({ fila }).fila).toBeNull();
    }
  });

  it("responsável é 'eu', 'nenhum' ou uuid; o resto é ignorado", () => {
    expect(parseTicketListParams({ responsavel: "eu" }).responsavel).toBe("eu");
    expect(parseTicketListParams({ responsavel: "nenhum" }).responsavel).toBe("nenhum");
    expect(parseTicketListParams({ responsavel: OTHER_USER.toUpperCase() }).responsavel).toBe(
      OTHER_USER
    );
    for (const responsavel of ["EU", "todos", "ana", `eq.${OTHER_USER}`]) {
      expect(parseTicketListParams({ responsavel }).responsavel).toBeNull();
    }
  });

  it("usa o primeiro valor quando o parâmetro se repete", () => {
    expect(parseTicketListParams({ status: ["novo", "todos"], page: ["2", "9"] })).toMatchObject({
      status: "novo",
      page: 2,
    });
  });

  it("página inválida vira 1; o termo é aparado e cortado em 100", () => {
    for (const page of [undefined, "", "0", "-3", "abc", "99999999999999999999"]) {
      expect(parseTicketListParams({ page }).page).toBe(1);
    }
    expect(parseTicketListParams({ q: "  SUP-1024  " }).q).toBe("SUP-1024");
    expect(parseTicketListParams({ q: "x".repeat(150) }).q).toHaveLength(100);
  });
});

describe("TICKET_LIST_SELECT", () => {
  it("não traz descrição, triagem da IA, chave idempotente, id externo nem coluna de filtro", () => {
    expect(TICKET_LIST_SELECT).not.toMatch(
      /\bdescription\b|ai_triage|idempotency_key|external_id|search_text|sla_breached|sla_at_risk|\*/
    );
  });

  it("todo embed tem hint pelo nome da FK (tickets tem 2 relações com app_users)", () => {
    expect(TICKET_LIST_SELECT).toContain("customer:customers!tickets_customer_id_fkey(");
    expect(TICKET_LIST_SELECT).toContain("contact:contacts!tickets_contact_id_fkey(");
    expect(TICKET_LIST_SELECT).toContain("product:products!tickets_product_id_fkey(");
    expect(TICKET_LIST_SELECT).toContain("assignee:app_users!tickets_assigned_to_user_id_fkey(");
  });
});

describe("getTicketsPage", () => {
  it("padrão: da view, só ativos, por prazo, 25 por página, com contagem exata", async () => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(params(), VIEWER);

    expect(fromMock).toHaveBeenCalledWith("ticket_queue");
    expect(calls).toEqual([
      ["select", TICKET_LIST_SELECT, { count: "exact", head: false }],
      ["neq", "sla_mode", "stopped"],
      ...BY_DUE,
      ["range", 0, 24],
    ]);
  });

  it.each(["SUP-1024", "#1024", "sup 1024", "1024"])(
    "protocolo %s vira number = 1024, sem busca por texto",
    async (q) => {
      const [calls] = queueQueries(ok([]));

      await getTicketsPage(params({ q, status: "todos" }), VIEWER);

      expect(filters(calls)).toEqual([["eq", "number", 1024]]);
    }
  );

  it.each(["ativos", "resolvidos", "encerrados", "novo", "cancelado"] as const)(
    "protocolo ignora o status %s: quem digita o protocolo quer aquele ticket",
    async (status) => {
      const [calls] = queueQueries(ok([]));

      await getTicketsPage(params({ q: "SUP-1024", status }), VIEWER);

      expect(filters(calls)).toEqual([["eq", "number", 1024]]);
    }
  );

  it("protocolo mantém os filtros que a pessoa escolheu", async () => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(
      params({ q: "#1024", status: "novo", prioridade: "alta", responsavel: "eu", sla: "risco" }),
      VIEWER
    );

    expect(filters(calls)).toEqual([
      ["eq", "number", 1024],
      ["eq", "priority", "alta"],
      ["eq", "assigned_to_user_id", VIEWER],
      ["eq", "sla_at_risk", true],
    ]);
  });

  it("texto que não é protocolo continua com o status", async () => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(params({ q: "nota 1024" }), VIEWER);

    expect(filters(calls)).toEqual([
      ["ilike", "search_text", "%nota%"],
      ["ilike", "search_text", "%1024%"],
      ["neq", "sla_mode", "stopped"],
    ]);
  });

  it("texto vira um ilike por token em search_text", async () => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(params({ q: "Padaria São João", status: "todos" }), VIEWER);

    expect(filters(calls)).toEqual([
      ["ilike", "search_text", "%padaria%"],
      ["ilike", "search_text", "%sao%"],
      ["ilike", "search_text", "%joao%"],
    ]);
  });

  it("termo sem token útil não vira filtro", async () => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(params({ q: " , ( ) % ", status: "todos" }), VIEWER);

    expect(filters(calls)).toEqual([]);
  });

  it.each([
    ["ativos", [["neq", "sla_mode", "stopped"]]],
    ["resolvidos", [["eq", "status", "resolvido"]]],
    ["encerrados", [["eq", "is_terminal", true]]],
    ["todos", []],
    ["aguardando_cliente", [["eq", "status", "aguardando_cliente"]]],
    ["cancelado", [["eq", "status", "cancelado"]]],
  ] as const)("status %s aplica o filtro certo", async (status, expected) => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(params({ status }), VIEWER);

    expect(filters(calls)).toEqual(expected);
  });

  it.each([
    [{ prioridade: "critica" }, [["eq", "priority", "critica"]]],
    [{ fila: "sem" }, [["is", "product_id", null]]],
    [{ fila: PRODUCT }, [["eq", "product_id", PRODUCT]]],
    [{ responsavel: "eu" }, [["eq", "assigned_to_user_id", VIEWER]]],
    [{ responsavel: "nenhum" }, [["is", "assigned_to_user_id", null]]],
    [{ responsavel: OTHER_USER }, [["eq", "assigned_to_user_id", OTHER_USER]]],
    [{ sla: "estourado" }, [["eq", "sla_breached", true]]],
    [{ sla: "risco" }, [["eq", "sla_at_risk", true]]],
    [{ sla: "pausado" }, [["eq", "sla_mode", "paused"]]],
  ] as const)("filtro %o", async (overrides, expected) => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(params({ status: "todos", ...overrides }), VIEWER);

    expect(filters(calls)).toEqual(expected);
  });

  it("fila e responsável que não são uuid nunca chegam ao filtro", async () => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(
      params({ status: "todos", fila: "x,product_id.not.is.null", responsavel: "or(1)" }),
      VIEWER
    );

    expect(filters(calls)).toEqual([]);
  });

  it("filtros se somam", async () => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(
      params({ status: "novo", prioridade: "alta", fila: "sem", responsavel: "nenhum", sla: "risco" }),
      VIEWER
    );

    expect(filters(calls)).toEqual([
      ["eq", "status", "novo"],
      ["eq", "priority", "alta"],
      ["is", "product_id", null],
      ["is", "assigned_to_user_id", null],
      ["eq", "sla_at_risk", true],
    ]);
  });

  it.each([
    [
      "recentes",
      [
        ["order", "created_at", { ascending: false }],
        ["order", "number", { ascending: false }],
      ],
    ],
    [
      "atualizados",
      [
        ["order", "updated_at", { ascending: false }],
        ["order", "number", { ascending: false }],
      ],
    ],
    ["prazo", BY_DUE],
  ] as const)("ordem %s", async (ordem, expected) => {
    const [calls] = queueQueries(ok([]));

    await getTicketsPage(params({ ordem }), VIEWER);

    expect(calls.filter(([method]) => method === "order")).toEqual(expected);
  });

  it("pagina de 25 em 25 e devolve o instante da leitura", async () => {
    const [calls] = queueQueries(ok([row()], 80));

    const result = await getTicketsPage(params({ page: 3 }), VIEWER);

    expect(calls.at(-1)).toEqual(["range", 50, 74]);
    expect(result).toMatchObject({
      page: 3,
      pageSize: 25,
      total: 80,
      pageCount: 4,
      failed: false,
      fetchedAt: NOW.toISOString(),
    });
  });

  it("monta cada item campo a campo: coluna e embed a mais não chegam ao payload", async () => {
    queueQueries(
      ok([
        row({
          description: "segredo do detalhe",
          ai_triage: { summary: "x" },
          idempotency_key: "k",
          search_text: "erro ao emitir",
          sla_breached: false,
          customer: { ...row().customer, cnpj: "12ABC34501DE35", search_name: "padaria" },
          contact: { ...row().contact, normalized_phone: "27999990000" },
          assignee: { ...row().assignee, email: "ana@exemplo.com" },
        }),
      ])
    );

    const [item] = (await getTicketsPage(params(), VIEWER)).items;

    expect(item).toEqual(row());
  });

  it("selo de contrato desconhecido vira null; embeds nulos continuam nulos", async () => {
    queueQueries(
      ok([
        row({ customer: { ...row().customer, contract_status: "cancelado" } }),
        row({ id: "t2", number: 1025, customer: null, product: null, assignee: null }),
      ])
    );

    const { items } = await getTicketsPage(params(), VIEWER);

    expect(items[0]?.customer?.contract_status).toBeNull();
    expect(items[1]).toMatchObject({ customer: null, product: null, assignee: null });
  });

  it.each([
    ["status desconhecido", { status: "arquivado" }],
    ["prioridade desconhecida", { priority: "urgente" }],
    ["origem desconhecida", { source: "email" }],
    ["modo desconhecido", { sla_mode: "frozen" }],
    ["sem contato", { contact: null }],
    ["sem número", { number: null }],
    ["sem versão", { version: null }],
  ])("linha inesperada (%s) falha a página em vez de esconder o ticket", async (_, overrides) => {
    queueQueries(ok([row(), row(overrides)], 2));

    const result = await getTicketsPage(params(), VIEWER);

    expect(result).toMatchObject({ items: [], total: 0, failed: true });
    expect(console.error).toHaveBeenCalled();
  });

  it("erro do banco devolve failed, não lista vazia comum", async () => {
    queueQueries({ data: null, error: { code: "42501", message: "permission denied" }, count: null });

    const result = await getTicketsPage(params({ page: 2 }), VIEWER);

    expect(result).toEqual({
      items: [],
      total: 0,
      page: 2,
      pageSize: 25,
      pageCount: 1,
      failed: true,
      fetchedAt: NOW.toISOString(),
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("sem Supabase configurado também é failed", async () => {
    envMock.mockReturnValue(false);

    expect((await getTicketsPage(params(), VIEWER)).failed).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("página além do fim (PGRST103) abre a última página que existe", async () => {
    const [first, head, retry] = queueQueries(
      { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null },
      { data: null, error: null, count: 30 },
      ok([row()], 30)
    );

    const result = await getTicketsPage(
      params({ q: "padaria", responsavel: "eu", ordem: "recentes", page: 9 }),
      VIEWER
    );

    expect(first.at(-1)).toEqual(["range", 200, 224]);
    // A contagem repete o recorte, sem ordem nem página.
    expect(head).toEqual([
      ["select", TICKET_LIST_SELECT, { count: "exact", head: true }],
      ["ilike", "search_text", "%padaria%"],
      ["neq", "sla_mode", "stopped"],
      ["eq", "assigned_to_user_id", VIEWER],
    ]);
    expect(retry.at(-1)).toEqual(["range", 25, 49]);
    expect(result).toMatchObject({ page: 2, total: 30, pageCount: 2, failed: false });
    expect(result.items).toHaveLength(1);
  });

  it("offset igual ao total (206 com lista vazia) abre a última página", async () => {
    const [first, retry] = queueQueries(ok([], 25), ok([row()], 25));

    const result = await getTicketsPage(params({ page: 2 }), VIEWER);

    expect(first.at(-1)).toEqual(["range", 25, 49]);
    expect(retry.at(-1)).toEqual(["range", 0, 24]);
    expect(result).toMatchObject({ page: 1, total: 25, pageCount: 1, failed: false });
    expect(result.items).toHaveLength(1);
  });

  it("se a contagem de socorro falha, a página é failed", async () => {
    queueQueries(
      { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null },
      { data: null, error: { code: "57014", message: "timeout" }, count: null }
    );

    expect((await getTicketsPage(params({ page: 5 }), VIEWER)).failed).toBe(true);
  });
});

describe("toTicketListItem", () => {
  it("guarda os instantes crus do PostgREST, com microssegundos", () => {
    const item = toTicketListItem(row());

    expect(item?.first_response_due_at).toBe("2026-09-25T13:00:00.123456+00:00");
    expect(item?.last_inbound_at).toBe("2026-09-25T12:05:00.000001+00:00");
  });
});
