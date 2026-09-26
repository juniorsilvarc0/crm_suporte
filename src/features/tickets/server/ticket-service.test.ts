import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const { pushTakeoverMock } = vi.hoisted(() => ({ pushTakeoverMock: vi.fn() }));

vi.mock("@/features/chat/lib/push-takeover", () => ({
  pushTakeoverToAgent: pushTakeoverMock,
}));

import {
  assignTicket,
  createTicket,
  setActiveTicket,
  takeOverTicket,
  transitionTicket,
  updateTicket,
  type TicketActor,
} from "@/features/tickets/server/ticket-service";
import type { TicketSummary } from "@/features/tickets/types";
import type { Database } from "@/lib/supabase/types";

// Ids fictícios. O jsonb das RPCs segue o formato conferido no banco local
// (instante com microssegundos e fuso, number como número).
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const CATEGORY_ID = "77777777-7777-4777-8777-777777777777";
const IDEMPOTENCY_KEY = "88888888-8888-4888-8888-888888888888";
// Endereço do canal (telefone): nunca pode chegar ao resultado nem ao log.
const EXTERNAL_ID = "5500900001111";
const TITLE = "Erro ao emitir relatório";

const USER: TicketActor = { kind: "user", userId: USER_ID };
const TOKEN: TicketActor = { kind: "token", tokenId: TOKEN_ID };

function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: TICKET_ID,
    number: 1024,
    title: TITLE,
    status: "em_atendimento",
    priority: "alta",
    version: 3,
    conversation_id: CONVERSATION_ID,
    assigned_to_user_id: USER_ID,
    product_id: null,
    category_id: null,
    customer_id: null,
    contract_id: null,
    first_response_due_at: "2026-09-26T04:03:13.996092+00:00",
    resolution_due_at: "2026-09-26T11:03:13.996092+00:00",
    first_responded_at: null,
    sla_paused_at: null,
    resolved_at: null,
    closed_at: null,
    updated_at: "2026-09-26T03:03:13.996092+00:00",
    ...overrides,
  };
}

type RpcResponse = { data: unknown; error: unknown };

function fakeDb(response: RpcResponse) {
  const rpc = vi.fn().mockResolvedValue(response);
  return { db: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

function ok(data: unknown): RpcResponse {
  return { data, error: null };
}

function dbError(message: string, extra: { code?: string; details?: string; hint?: string } = {}) {
  return {
    data: null,
    error: { message, code: extra.code ?? "P0001", details: extra.details ?? "", hint: extra.hint ?? "" },
  };
}

// O que vai de fato para o PostgREST: o supabase-js serializa os argumentos em
// JSON, e chave com undefined some. É isso que a RPC enxerga como "ausente".
function sentArgs(rpc: Mock) {
  const [name, args] = rpc.mock.calls[0] as [string, unknown];
  return { name, args: JSON.parse(JSON.stringify(args)) as Record<string, unknown> };
}

const createInput = {
  conversation_id: CONVERSATION_ID,
  title: TITLE,
  priority: "alta" as const,
  description: null,
  product_id: null,
  category_id: null,
  take_over: true,
  idempotency_key: IDEMPOTENCY_KEY,
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  pushTakeoverMock.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("createTicket", () => {
  it("abre com o ator da sessão, omite opcionais nulos e avisa a IA quando a conversa virou human", async () => {
    const { db, rpc } = fakeDb(
      ok({
        ticket: summary(),
        created: true,
        linked_messages: 2,
        conversation_changed: true,
        conversation_external_id: EXTERNAL_ID,
      })
    );

    const result = await createTicket(db, USER, createInput);

    expect(sentArgs(rpc)).toStrictEqual({
      name: "create_ticket",
      args: {
        p_actor_user_id: USER_ID,
        p_conversation_id: CONVERSATION_ID,
        p_title: TITLE,
        p_priority: "alta",
        p_take_over: true,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    });
    expect(result).toStrictEqual({
      ok: true,
      data: { ticket: summary(), created: true, linked_messages: 2 },
    });
    expect(pushTakeoverMock).toHaveBeenCalledTimes(1);
    expect(pushTakeoverMock).toHaveBeenCalledWith(EXTERNAL_ID, true);
    expect(JSON.stringify(result)).not.toContain(EXTERNAL_ID);
    expect(JSON.stringify(result)).not.toContain("conversation_changed");
  });

  it("repassa descrição, fila e categoria presentes e usa o token como ator", async () => {
    const { db, rpc } = fakeDb(
      ok({
        ticket: summary({ status: "novo", assigned_to_user_id: null, version: 1 }),
        created: true,
        linked_messages: 0,
        conversation_changed: false,
        conversation_external_id: EXTERNAL_ID,
      })
    );

    await createTicket(db, TOKEN, {
      ...createInput,
      description: "Relatório mensal sai em branco.",
      product_id: PRODUCT_ID,
      category_id: CATEGORY_ID,
      take_over: false,
    });

    expect(sentArgs(rpc).args).toStrictEqual({
      p_actor_token_id: TOKEN_ID,
      p_conversation_id: CONVERSATION_ID,
      p_title: TITLE,
      p_priority: "alta",
      p_description: "Relatório mensal sai em branco.",
      p_product_id: PRODUCT_ID,
      p_category_id: CATEGORY_ID,
      p_take_over: false,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it("devolve o replay da mesma chave com created=false e sem avisar a IA", async () => {
    const { db } = fakeDb(
      ok({
        ticket: summary(),
        created: false,
        linked_messages: 0,
        conversation_changed: false,
        conversation_external_id: EXTERNAL_ID,
      })
    );

    const result = await createTicket(db, USER, createInput);

    expect(result).toStrictEqual({
      ok: true,
      data: { ticket: summary(), created: false, linked_messages: 0 },
    });
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("traduz IDEMPOTENCY_KEY_REUSED em 409 sem avisar a IA nem logar", async () => {
    const { db } = fakeDb(dbError("IDEMPOTENCY_KEY_REUSED"));

    const result = await createTicket(db, USER, createInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ status: 409, code: "idempotency_key_reused" });
    expect(pushTakeoverMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("recusa ticket com chave fora do resumo (500 logado), mas avisa a IA do takeover já gravado", async () => {
    const { db } = fakeDb(
      ok({
        ticket: { ...summary(), ai_triage: { resumo: "x" } },
        created: true,
        linked_messages: 0,
        conversation_changed: true,
        conversation_external_id: EXTERNAL_ID,
      })
    );

    const result = await createTicket(db, USER, createInput);

    expect(result).toStrictEqual({
      ok: false,
      error: { status: 500, code: "internal", message: "Não foi possível concluir a operação." },
    });
    expect(pushTakeoverMock).toHaveBeenCalledWith(EXTERNAL_ID, true);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("[ticket-service] createTicket");
    expect(logged).toContain("ai_triage");
    // O log leva o caminho e o motivo, nunca o jsonb (título e telefone).
    expect(logged).not.toContain(EXTERNAL_ID);
    expect(logged).not.toContain(TITLE);
  });

  it("responde 500 sem avisar a IA quando o envelope não traz o sinal do takeover", async () => {
    const { db } = fakeDb(ok({ ticket: summary(), created: true, linked_messages: 0 }));

    const result = await createTicket(db, USER, createInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(500);
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });
});

describe("updateTicket", () => {
  it("manda só os campos presentes, mantém o null que tira o valor e a versão lida", async () => {
    const ticket = summary({ title: "Relatório mensal em branco", version: 4 });
    const { db, rpc } = fakeDb(ok({ ticket, changed: true }));

    const result = await updateTicket(db, USER, TICKET_ID, 3, {
      title: "Relatório mensal em branco",
      product_id: null,
      category_id: undefined,
    });

    expect(sentArgs(rpc)).toStrictEqual({
      name: "ticket_update",
      args: {
        p_actor_user_id: USER_ID,
        p_ticket_id: TICKET_ID,
        p_expected_version: 3,
        p_patch: { title: "Relatório mensal em branco", product_id: null },
      },
    });
    expect(result).toStrictEqual({ ok: true, data: { ticket, changed: true } });
  });

  it("não deixa chave fora da allowlist do PATCH chegar à RPC", async () => {
    const { db, rpc } = fakeDb(ok({ ticket: summary(), changed: false }));

    const patch = { priority: "baixa", status: "fechado", assigned_to_user_id: OTHER_USER_ID };
    await updateTicket(db, USER, TICKET_ID, 3, patch as Parameters<typeof updateTicket>[4]);

    expect(sentArgs(rpc).args.p_patch).toStrictEqual({ priority: "baixa" });
  });

  it("traduz VERSION_CONFLICT em 409 com a versão atual", async () => {
    const { db } = fakeDb(dbError("VERSION_CONFLICT", { details: "7" }));

    const result = await updateTicket(db, USER, TICKET_ID, 3, { title: "Outro título" });

    expect(result).toStrictEqual({
      ok: false,
      error: {
        status: 409,
        code: "version_conflict",
        message: "O ticket mudou em outro lugar. Recarregue para ver a versão atual.",
        currentVersion: 7,
      },
    });
  });

  it("responde 500 quando a RPC não devolve nada", async () => {
    const { db } = fakeDb(ok(null));

    const result = await updateTicket(db, USER, TICKET_ID, 3, { title: "Outro título" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ status: 500, code: "internal" });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe("transitionTicket", () => {
  it("move o ticket e omite o motivo ausente", async () => {
    const ticket = summary({ status: "aguardando_cliente", version: 5 });
    const { db, rpc } = fakeDb(
      ok({ ticket, from: "em_atendimento", to: "aguardando_cliente", changed: true })
    );

    const result = await transitionTicket(db, USER, TICKET_ID, "aguardando_cliente", 4, null);

    expect(sentArgs(rpc)).toStrictEqual({
      name: "ticket_transition",
      args: {
        p_actor_user_id: USER_ID,
        p_ticket_id: TICKET_ID,
        p_to: "aguardando_cliente",
        p_expected_version: 4,
      },
    });
    expect(result).toStrictEqual({
      ok: true,
      data: { ticket, from: "em_atendimento", to: "aguardando_cliente", changed: true },
    });
  });

  it("repassa o motivo do cancelamento", async () => {
    const { db, rpc } = fakeDb(
      ok({
        ticket: summary({ status: "cancelado", closed_at: "2026-09-26T05:00:00+00:00" }),
        from: "em_atendimento",
        to: "cancelado",
        changed: true,
      })
    );

    await transitionTicket(db, USER, TICKET_ID, "cancelado", 4, "Cliente abriu em duplicidade.");

    expect(sentArgs(rpc).args).toMatchObject({ p_reason: "Cliente abriu em duplicidade." });
  });

  it("traduz INVALID_TRANSITION em 409 com os destinos permitidos e o status atual", async () => {
    const { db } = fakeDb(
      dbError("INVALID_TRANSITION", {
        details: '["aguardando_cliente", "aguardando_interno", "resolvido", "cancelado"]',
        hint: "em_atendimento",
      })
    );

    const result = await transitionTicket(db, USER, TICKET_ID, "novo", 4);

    expect(result).toStrictEqual({
      ok: false,
      error: {
        status: 409,
        code: "invalid_transition",
        message: "Esse movimento não é permitido a partir do status atual.",
        allowed: ["aguardando_cliente", "aguardando_interno", "resolvido", "cancelado"],
        current: "em_atendimento",
      },
    });
  });

  it("responde 500 quando o status devolvido não é uma chave conhecida", async () => {
    const { db } = fakeDb(
      ok({ ticket: summary(), from: "em_atendimento", to: "arquivado", changed: true })
    );

    const result = await transitionTicket(db, USER, TICKET_ID, "resolvido", 4);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(500);
  });
});

describe("assignTicket", () => {
  it("atribui ao responsável informado", async () => {
    const ticket = summary({ assigned_to_user_id: OTHER_USER_ID, version: 4 });
    const { db, rpc } = fakeDb(ok({ ticket, changed: true }));

    const result = await assignTicket(db, USER, TICKET_ID, 3, OTHER_USER_ID);

    expect(sentArgs(rpc)).toStrictEqual({
      name: "ticket_assign",
      args: {
        p_actor_user_id: USER_ID,
        p_ticket_id: TICKET_ID,
        p_expected_version: 3,
        p_assignee_id: OTHER_USER_ID,
      },
    });
    expect(result).toStrictEqual({ ok: true, data: { ticket, changed: true } });
  });

  it("tira o responsável omitindo a chave (default null da RPC)", async () => {
    const { db, rpc } = fakeDb(ok({ ticket: summary({ assigned_to_user_id: null }), changed: true }));

    await assignTicket(db, USER, TICKET_ID, 3, null);

    expect(sentArgs(rpc).args).toStrictEqual({
      p_actor_user_id: USER_ID,
      p_ticket_id: TICKET_ID,
      p_expected_version: 3,
    });
  });

  it("traduz ASSIGNEE_INACTIVE em 422 no campo do responsável", async () => {
    const { db } = fakeDb(dbError("ASSIGNEE_INACTIVE"));

    const result = await assignTicket(db, USER, TICKET_ID, 3, OTHER_USER_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      status: 422,
      code: "assignee_inactive",
      field: "assignee_id",
    });
  });
});

describe("setActiveTicket", () => {
  it("põe o ticket em foco", async () => {
    const { db, rpc } = fakeDb(ok({ active_ticket_id: TICKET_ID, changed: true }));

    const result = await setActiveTicket(db, USER, CONVERSATION_ID, TICKET_ID);

    expect(sentArgs(rpc)).toStrictEqual({
      name: "ticket_set_active",
      args: {
        p_actor_user_id: USER_ID,
        p_conversation_id: CONVERSATION_ID,
        p_ticket_id: TICKET_ID,
      },
    });
    expect(result).toStrictEqual({
      ok: true,
      data: { active_ticket_id: TICKET_ID, changed: true },
    });
  });

  it("tira o foco omitindo a chave do ticket", async () => {
    const { db, rpc } = fakeDb(ok({ active_ticket_id: null, changed: false }));

    const result = await setActiveTicket(db, USER, CONVERSATION_ID, null);

    expect(sentArgs(rpc).args).toStrictEqual({
      p_actor_user_id: USER_ID,
      p_conversation_id: CONVERSATION_ID,
    });
    expect(result).toStrictEqual({ ok: true, data: { active_ticket_id: null, changed: false } });
  });

  it("traduz TICKET_NOT_IN_CONVERSATION em 422 no campo do ticket", async () => {
    const { db } = fakeDb(dbError("TICKET_NOT_IN_CONVERSATION"));

    const result = await setActiveTicket(db, USER, CONVERSATION_ID, TICKET_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ status: 422, field: "ticket_id" });
  });

  it("responde 500 quando o foco devolvido não é uuid", async () => {
    const { db } = fakeDb(ok({ active_ticket_id: "SUP-1024", changed: true }));

    const result = await setActiveTicket(db, USER, CONVERSATION_ID, TICKET_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(500);
  });
});

describe("takeOverTicket", () => {
  function takeOverData(overrides: Record<string, unknown> = {}) {
    return {
      ticket: summary(),
      conversation_id: CONVERSATION_ID,
      conversation_status: "human",
      conversation_changed: true,
      conversation_external_id: EXTERNAL_ID,
      ...overrides,
    };
  }

  it("assume como o usuário, avisa a IA e devolve só a conversa, sem o telefone", async () => {
    const { db, rpc } = fakeDb(ok(takeOverData()));

    const result = await takeOverTicket(db, USER_ID, TICKET_ID, false);

    expect(sentArgs(rpc)).toStrictEqual({
      name: "ticket_take_over",
      args: { p_ticket_id: TICKET_ID, p_actor_user_id: USER_ID, p_reassign: false },
    });
    expect(result).toStrictEqual({
      ok: true,
      data: { ticket: summary(), conversation: { id: CONVERSATION_ID, status: "human" } },
    });
    expect(pushTakeoverMock).toHaveBeenCalledTimes(1);
    expect(pushTakeoverMock).toHaveBeenCalledWith(EXTERNAL_ID, true);
    expect(JSON.stringify(result)).not.toContain(EXTERNAL_ID);
  });

  it("não avisa a IA quando a conversa já era human", async () => {
    const { db, rpc } = fakeDb(ok(takeOverData({ conversation_changed: false })));

    const result = await takeOverTicket(db, USER_ID, TICKET_ID, true);

    expect(sentArgs(rpc).args).toMatchObject({ p_reassign: true });
    expect(result.ok).toBe(true);
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("traduz ALREADY_ASSIGNED em 409 com quem está com o ticket, sem avisar a IA", async () => {
    const { db } = fakeDb(dbError("ALREADY_ASSIGNED", { details: OTHER_USER_ID }));

    const result = await takeOverTicket(db, USER_ID, TICKET_ID, false);

    expect(result).toStrictEqual({
      ok: false,
      error: {
        status: 409,
        code: "already_assigned",
        message: "Este ticket já está com outro analista.",
        assignedToUserId: OTHER_USER_ID,
      },
    });
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("responde 500 quando a conversa não volta como human", async () => {
    const { db } = fakeDb(ok(takeOverData({ conversation_status: "bot", conversation_changed: false })));

    const result = await takeOverTicket(db, USER_ID, TICKET_ID, false);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(500);
  });
});

describe("erros do banco", () => {
  it("loga o 500 com o code e a message, nunca o DETAIL, e não repassa o texto ao cliente", async () => {
    const { db } = fakeDb(
      dbError("permission denied for table tickets", {
        code: "42501",
        details: `Failing row contains (${EXTERNAL_ID})`,
      })
    );

    const result = await transitionTicket(db, USER, TICKET_ID, "resolvido", 4);

    expect(result).toStrictEqual({
      ok: false,
      error: { status: 500, code: "internal", message: "Não foi possível concluir a operação." },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[ticket-service] transitionTicket",
      "42501",
      "permission denied for table tickets"
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(EXTERNAL_ID);
  });

  it("não loga o erro de negócio (4xx)", async () => {
    const { db } = fakeDb(dbError("FORBIDDEN", { details: "Usuário inativo ou inexistente." }));

    const result = await setActiveTicket(db, USER, CONVERSATION_ID, null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ status: 403, code: "forbidden" });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
