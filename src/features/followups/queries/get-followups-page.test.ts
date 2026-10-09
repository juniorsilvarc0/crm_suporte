import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import {
  FOLLOWUP_QUEUE_SELECT,
  getFollowupsQueuePage,
  parseFollowupQueueParams,
} from "@/features/followups/queries/get-followups-page";
import type { FollowupQueueParams } from "@/features/followups/types";

type Call = [method: string, ...args: unknown[]];

const VIEWER = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "eq", "lt", "order", "range"]) {
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

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "f1",
  kind: "retorno",
  status: "pendente",
  due_at: "2026-10-10T13:00:00+00:00",
  notes: "Ligar para confirmar a correção.",
  done_at: null,
  ticket: {
    id: "t1",
    number: 1024,
    title: "Erro ao emitir nota fiscal",
    status: "em_atendimento",
    assigned_to_user_id: VIEWER,
    customer: { id: "c1", legal_name: "Padaria S. João Ltda", trade_name: "Padaria São João" },
  },
  ...overrides,
});

const params = (overrides: Partial<FollowupQueueParams> = {}): FollowupQueueParams => ({
  situacao: "pendentes",
  responsavel: "todos",
  page: 1,
  ...overrides,
});

beforeEach(() => {
  fromMock.mockReset();
  envMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("parseFollowupQueueParams", () => {
  it("abre os pendentes de todos os tickets, na página 1, sem filtro na URL", () => {
    expect(parseFollowupQueueParams({})).toEqual({ situacao: "pendentes", responsavel: "todos", page: 1 });
  });

  it("aceita os recortes conhecidos e o responsável 'eu'", () => {
    expect(parseFollowupQueueParams({ situacao: "vencidos", responsavel: "eu", page: "3" })).toEqual({
      situacao: "vencidos",
      responsavel: "eu",
      page: 3,
    });
  });

  it("valor fora da allowlist vira o padrão, não erro", () => {
    expect(parseFollowupQueueParams({ situacao: "atrasados", responsavel: "outro", page: "-2" })).toEqual({
      situacao: "pendentes",
      responsavel: "todos",
      page: 1,
    });
    expect(parseFollowupQueueParams({ situacao: ["concluidos", "todos"], page: "abc" })).toMatchObject({
      situacao: "concluidos",
      page: 1,
    });
  });
});

describe("getFollowupsQueuePage", () => {
  it("lê os pendentes do prazo mais próximo, com o ticket e a empresa, sem levar o responsável à tela", async () => {
    const [calls] = queueQueries({ data: [row()], count: 1, error: null });

    const page = await getFollowupsQueuePage(params(), VIEWER);

    expect(fromMock).toHaveBeenCalledWith("followups");
    expect(calls).toEqual([
      ["select", FOLLOWUP_QUEUE_SELECT, { count: "exact", head: false }],
      ["eq", "status", "pendente"],
      ["order", "due_at", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["range", 0, 24],
    ]);
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 25, pageCount: 1, failed: false });
    expect(page.items).toEqual([
      {
        id: "f1",
        kind: "retorno",
        status: "pendente",
        due_at: "2026-10-10T13:00:00+00:00",
        notes: "Ligar para confirmar a correção.",
        done_at: null,
        ticket: {
          id: "t1",
          number: 1024,
          title: "Erro ao emitir nota fiscal",
          status: "em_atendimento",
          customer: { id: "c1", legal_name: "Padaria S. João Ltda", trade_name: "Padaria São João" },
        },
      },
    ]);
  });

  it("vencidos = pendentes com prazo antes do instante da leitura, o mesmo que a tela recebe", async () => {
    const [calls] = queueQueries({ data: [], count: 0, error: null });

    const page = await getFollowupsQueuePage(params({ situacao: "vencidos" }), VIEWER);

    expect(calls).toContainEqual(["eq", "status", "pendente"]);
    expect(calls).toContainEqual(["lt", "due_at", page.fetchedAt]);
    expect(Number.isNaN(Date.parse(page.fetchedAt))).toBe(false);
  });

  it("concluídos saem do mais recente; todos não filtram a situação", async () => {
    const [concluidos, todos] = queueQueries(
      { data: [], count: 0, error: null },
      { data: [], count: 0, error: null }
    );

    await getFollowupsQueuePage(params({ situacao: "concluidos" }), VIEWER);
    await getFollowupsQueuePage(params({ situacao: "todos" }), VIEWER);

    expect(concluidos).toContainEqual(["eq", "status", "concluido"]);
    expect(concluidos).toContainEqual(["order", "due_at", { ascending: false }]);
    expect(todos.some(([method]) => method === "eq")).toBe(false);
    expect(todos).toContainEqual(["order", "due_at", { ascending: false }]);
  });

  it("'Meus tickets' filtra pelo responsável do ticket de quem vê a fila", async () => {
    const [calls] = queueQueries({ data: [], count: 0, error: null });

    await getFollowupsQueuePage(params({ responsavel: "eu" }), VIEWER);

    expect(calls).toContainEqual(["eq", "ticket.assigned_to_user_id", VIEWER]);
  });

  it("erro do banco vira página vazia MARCADA, não 'nenhum retorno'", async () => {
    queueQueries({ data: null, count: null, error: { code: "42P01", message: "boom" } });

    const page = await getFollowupsQueuePage(params(), VIEWER);

    expect(page).toMatchObject({ items: [], total: 0, failed: true });
  });

  it("linha que não fecha com o tipo derruba a página inteira para o estado de falha", async () => {
    queueQueries({ data: [row(), row({ id: "f2", kind: "visita" })], count: 2, error: null });

    const page = await getFollowupsQueuePage(params(), VIEWER);

    expect(page).toMatchObject({ items: [], failed: true });
  });

  it("página além do fim conta de novo e abre a última que existe", async () => {
    const [first, recount, last] = queueQueries(
      { data: null, count: null, error: { code: "PGRST103", message: "range" } },
      { data: null, count: 30, error: null },
      { data: [row()], count: 30, error: null }
    );

    const page = await getFollowupsQueuePage(params({ page: 9 }), VIEWER);

    expect(first).toContainEqual(["range", 200, 224]);
    expect(recount[0]).toEqual(["select", FOLLOWUP_QUEUE_SELECT, { count: "exact", head: true }]);
    expect(last).toContainEqual(["range", 25, 49]);
    expect(page).toMatchObject({ page: 2, pageCount: 2, total: 30, failed: false });
  });

  it("sem o Supabase configurado, falha marcada sem consultar", async () => {
    envMock.mockReturnValue(false);

    const page = await getFollowupsQueuePage(params(), VIEWER);

    expect(page.failed).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
