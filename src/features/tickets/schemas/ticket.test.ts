import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  TICKET_PATCH_FIELDS,
  ticketAssignSchema,
  ticketCreateSchema,
  ticketFocusSchema,
  ticketPatchSchema,
  ticketSummarySchema,
  ticketTakeOverSchema,
  ticketTimelineQuerySchema,
  ticketTransitionSchema,
} from "@/features/tickets/schemas/ticket";

const CONVERSATION_ID = "448b209e-96be-4900-a96e-cc6dd636f6f8";
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "34f544d9-b6ee-4119-9905-23d4e63e7611";
const TICKET_ID = "1c77ebc1-8b60-43a7-8b12-5ac4f7d43c6d";
const KEY = "aaaaaaaa-1111-4111-8111-111111111111";

function fieldErrors(result: { error?: z.ZodError }): Record<string, string[] | undefined> {
  return result.error ? z.flattenError(result.error).fieldErrors : {};
}

// Como o "Novo ticket" do chat envia.
const createValues = {
  conversation_id: CONVERSATION_ID,
  title: "Erro ao emitir nota",
  priority: "alta",
  idempotency_key: KEY,
};

describe("ticketCreateSchema", () => {
  it("aceita o mínimo e liga o 'Assumir o atendimento' por padrão", () => {
    const result = ticketCreateSchema.safeParse(createValues);

    expect(result.data).toEqual({ ...createValues, take_over: true });
  });

  it("opcionais ausentes ficam AUSENTES (a RPC usa o default dela)", () => {
    const data = ticketCreateSchema.parse(createValues);

    expect(Object.keys(data).sort()).toEqual(
      ["conversation_id", "idempotency_key", "priority", "take_over", "title"].sort()
    );
  });

  it("apara o título e aceita de 3 a 200 caracteres", () => {
    expect(ticketCreateSchema.parse({ ...createValues, title: "  Nota  " }).title).toBe("Nota");
    expect(ticketCreateSchema.safeParse({ ...createValues, title: "a".repeat(200) }).success).toBe(
      true
    );
  });

  it.each([["ab"], ["  ab  "], ["a".repeat(201)], [""], [null], [42]])(
    "recusa o título %j no campo title",
    (title) => {
      const result = ticketCreateSchema.safeParse({ ...createValues, title });

      expect(fieldErrors(result).title).toHaveLength(1);
    }
  );

  it("descrição vazia vira null; texto é aparado; o teto é 10.000", () => {
    expect(ticketCreateSchema.parse({ ...createValues, description: "   " }).description).toBeNull();
    expect(ticketCreateSchema.parse({ ...createValues, description: " Passo 1 " }).description).toBe(
      "Passo 1"
    );
    expect(
      ticketCreateSchema.safeParse({ ...createValues, description: "a".repeat(10001) }).success
    ).toBe(false);
  });

  it("fila e categoria: uuid, null ou vazio (= null)", () => {
    const data = ticketCreateSchema.parse({
      ...createValues,
      product_id: PRODUCT_ID,
      category_id: CATEGORY_ID,
    });

    expect(data.product_id).toBe(PRODUCT_ID);
    expect(data.category_id).toBe(CATEGORY_ID);
    expect(ticketCreateSchema.parse({ ...createValues, category_id: "" }).category_id).toBeNull();
    expect(ticketCreateSchema.parse({ ...createValues, product_id: null }).product_id).toBeNull();
    expect(fieldErrors(ticketCreateSchema.safeParse({ ...createValues, product_id: "fila" })).product_id).toEqual([
      "Fila inválida.",
    ]);
  });

  it("aceita desligar o 'Assumir' e recusa valor que não é booleano", () => {
    expect(ticketCreateSchema.parse({ ...createValues, take_over: false }).take_over).toBe(false);
    expect(ticketCreateSchema.safeParse({ ...createValues, take_over: "false" }).success).toBe(false);
  });

  it("exige a prioridade dentre as quatro", () => {
    const withoutPriority: Record<string, unknown> = { ...createValues };
    delete withoutPriority.priority;

    expect(fieldErrors(ticketCreateSchema.safeParse(withoutPriority)).priority).toEqual([
      "Escolha a prioridade.",
    ]);
    expect(ticketCreateSchema.safeParse({ ...createValues, priority: "urgente" }).success).toBe(false);
  });

  it("exige a chave de idempotência como uuid e a guarda minúscula", () => {
    const withoutKey: Record<string, unknown> = { ...createValues };
    delete withoutKey.idempotency_key;

    expect(fieldErrors(ticketCreateSchema.safeParse(withoutKey)).idempotency_key).toHaveLength(1);
    expect(ticketCreateSchema.safeParse({ ...createValues, idempotency_key: "abc" }).success).toBe(false);
    expect(
      ticketCreateSchema.parse({ ...createValues, idempotency_key: KEY.toUpperCase() }).idempotency_key
    ).toBe(KEY);
  });

  it("exige a conversa como uuid", () => {
    expect(
      fieldErrors(ticketCreateSchema.safeParse({ ...createValues, conversation_id: "1" })).conversation_id
    ).toEqual(["Conversa inválida."]);
  });

  it.each([
    ["actor_user_id", USER_ID],
    ["assigned_to_user_id", USER_ID],
    ["source", "api"],
    ["status", "em_triagem"],
    ["ai_triage", {}],
    ["external_id", "x-1"],
  ])("recusa %s no corpo (.strict): ator e integração não vêm da tela", (key, value) => {
    expect(ticketCreateSchema.safeParse({ ...createValues, [key]: value }).success).toBe(false);
  });
});

describe("ticketPatchSchema", () => {
  it("devolve só a versão e os campos enviados", () => {
    expect(ticketPatchSchema.parse({ version: 3, title: " Novo título " })).toEqual({
      version: 3,
      title: "Novo título",
    });
  });

  it("null tira a fila, a categoria e a empresa; vazio também", () => {
    expect(
      ticketPatchSchema.parse({ version: 2, product_id: null, category_id: "", customer_id: null })
    ).toEqual({ version: 2, product_id: null, category_id: null, customer_id: null });
  });

  it("descrição vazia apaga (null), e a chave continua presente", () => {
    const data = ticketPatchSchema.parse({ version: 2, description: "  " });

    expect(data).toHaveProperty("description", null);
  });

  it("exige ao menos um campo além da versão", () => {
    const result = ticketPatchSchema.safeParse({ version: 2 });

    expect(result.success).toBe(false);
    expect(result.error ? z.flattenError(result.error).formErrors : []).toEqual([
      "Nada para atualizar.",
    ]);
  });

  it.each([[undefined], [0], [-1], [1.5], ["3"], [2147483648]])("recusa a versão %j", (version) => {
    expect(
      fieldErrors(ticketPatchSchema.safeParse({ version, title: "Título" })).version
    ).toEqual(["Versão inválida."]);
  });

  it("recusa título nulo ou curto e prioridade desconhecida", () => {
    expect(ticketPatchSchema.safeParse({ version: 1, title: null }).success).toBe(false);
    expect(ticketPatchSchema.safeParse({ version: 1, title: "ab" }).success).toBe(false);
    expect(ticketPatchSchema.safeParse({ version: 1, priority: "urgente" }).success).toBe(false);
  });

  it.each(["status", "assigned_to_user_id", "contract_id", "conversation_id", "version_expected"])(
    "recusa %s (.strict: status, responsável e contrato têm porta própria)",
    (key) => {
      expect(ticketPatchSchema.safeParse({ version: 1, title: "Título", [key]: null }).success).toBe(
        false
      );
    }
  );

  it("TICKET_PATCH_FIELDS são os campos do schema e as chaves que ticket_update aceita", () => {
    const shapeKeys = Object.keys(ticketPatchSchema.shape).filter((key) => key !== "version");

    expect([...TICKET_PATCH_FIELDS].sort()).toEqual(shapeKeys.sort());
  });
});

describe("ticketTransitionSchema", () => {
  it("aceita mover sem motivo; o motivo ausente vira null", () => {
    expect(ticketTransitionSchema.parse({ to: "resolvido", version: 4 })).toEqual({
      to: "resolvido",
      version: 4,
      reason: null,
    });
  });

  it("exige motivo não vazio para cancelar, no campo reason", () => {
    for (const reason of [undefined, null, "", "   "]) {
      const result = ticketTransitionSchema.safeParse({ to: "cancelado", version: 1, reason });

      expect(fieldErrors(result).reason).toEqual(["Informe o motivo do cancelamento."]);
    }
  });

  it("apara o motivo e limita a 500", () => {
    expect(
      ticketTransitionSchema.parse({ to: "cancelado", version: 1, reason: " Duplicado " }).reason
    ).toBe("Duplicado");
    expect(
      ticketTransitionSchema.safeParse({ to: "cancelado", version: 1, reason: "a".repeat(501) }).success
    ).toBe(false);
  });

  it("recusa status fora das 8 chaves", () => {
    for (const to of ["arquivado", "Novo", "constructor", null]) {
      expect(fieldErrors(ticketTransitionSchema.safeParse({ to, version: 1 })).to).toEqual([
        "Status inválido.",
      ]);
    }
  });

  it("recusa campo extra e versão ausente", () => {
    expect(ticketTransitionSchema.safeParse({ to: "resolvido", version: 1, from: "novo" }).success).toBe(
      false
    );
    expect(ticketTransitionSchema.safeParse({ to: "resolvido" }).success).toBe(false);
  });
});

// NUL e surrogate solto passariam no zod e voltariam do banco como 22P05 (ou
// PGRST102, do PostgREST): um 500. O schema recusa antes, com o campo marcado.
const UNSAFE_MESSAGE = "Remova os caracteres inválidos.";
// Um par de surrogates válido (emoji): o mesmo "\uD83D" de "a\uD83D", inteiro.
const EMOJI = "\uD83D\uDE05";

describe("texto que o Postgres não guarda", () => {
  it("emoji passa no título, na descrição e no motivo", () => {
    const text = `Tela trava ${EMOJI} ao salvar`;

    expect(ticketCreateSchema.parse({ ...createValues, title: text, description: text })).toMatchObject(
      { title: text, description: text }
    );
    expect(ticketTransitionSchema.parse({ to: "cancelado", version: 1, reason: text }).reason).toBe(text);
  });

  it.each([
    ["NUL", "abc\u0000def"],
    ["surrogate baixo solto", "abc\uDC00def"],
    ["surrogate alto seguido de letra", "\uD800x"],
    ["surrogate alto no fim", "a\uD83D"],
  ])("recusa %s no título, na descrição e no motivo", (_, text) => {
    expect(fieldErrors(ticketCreateSchema.safeParse({ ...createValues, title: text })).title).toContain(
      UNSAFE_MESSAGE
    );
    expect(
      fieldErrors(ticketCreateSchema.safeParse({ ...createValues, description: text })).description
    ).toContain(UNSAFE_MESSAGE);
    expect(
      fieldErrors(ticketTransitionSchema.safeParse({ to: "cancelado", version: 1, reason: text })).reason
    ).toContain(UNSAFE_MESSAGE);
  });
});

describe("ticketAssignSchema", () => {
  it("aceita um responsável ou null explícito", () => {
    expect(ticketAssignSchema.parse({ assignee_id: USER_ID, version: 2 })).toEqual({
      assignee_id: USER_ID,
      version: 2,
    });
    expect(ticketAssignSchema.parse({ assignee_id: null, version: 2 }).assignee_id).toBeNull();
  });

  it("exige a chave: esquecê-la não tira o responsável em silêncio", () => {
    expect(fieldErrors(ticketAssignSchema.safeParse({ version: 2 })).assignee_id).toEqual([
      "Responsável inválido.",
    ]);
  });

  it("recusa id que não é uuid e campo extra", () => {
    expect(ticketAssignSchema.safeParse({ assignee_id: "ana", version: 2 }).success).toBe(false);
    expect(
      ticketAssignSchema.safeParse({ assignee_id: USER_ID, version: 2, actor_user_id: USER_ID }).success
    ).toBe(false);
  });
});

describe("ticketTakeOverSchema", () => {
  it("reassign é falso por padrão", () => {
    expect(ticketTakeOverSchema.parse({})).toEqual({ reassign: false });
    expect(ticketTakeOverSchema.parse({ reassign: true })).toEqual({ reassign: true });
  });

  it("recusa valor que não é booleano e campo extra", () => {
    expect(ticketTakeOverSchema.safeParse({ reassign: "sim" }).success).toBe(false);
    expect(ticketTakeOverSchema.safeParse({ user_id: USER_ID }).success).toBe(false);
  });
});

describe("ticketFocusSchema", () => {
  it("aceita um ticket ou null (conversa sem foco)", () => {
    expect(ticketFocusSchema.parse({ ticket_id: TICKET_ID })).toEqual({ ticket_id: TICKET_ID });
    expect(ticketFocusSchema.parse({ ticket_id: null })).toEqual({ ticket_id: null });
  });

  it("exige a chave e recusa o que não é uuid", () => {
    expect(ticketFocusSchema.safeParse({}).success).toBe(false);
    expect(fieldErrors(ticketFocusSchema.safeParse({ ticket_id: "SUP-1024" })).ticket_id).toEqual([
      "Ticket inválido.",
    ]);
  });
});

describe("ticketTimelineQuerySchema", () => {
  it("sem cursor = a página mais recente", () => {
    expect(ticketTimelineQuerySchema.parse({})).toEqual({});
  });

  it.each([
    "2026-09-26T02:50:13.236581+00:00",
    "2026-09-26T02:50:13.2365+00:00",
    "2026-09-26T02:50:13+00:00",
    "2026-09-25T23:50:13.1-03:00",
    "2026-09-26T02:50:13Z",
  ])("aceita o instante do PostgREST %s e o devolve CRU", (before) => {
    expect(ticketTimelineQuerySchema.parse({ before })).toEqual({ before });
  });

  it.each([
    ["o '+' do fuso que a URL virou espaço", "2026-09-26T02:50:13.236581 00:00"],
    ["mais de 6 casas (o Postgres arredondaria)", "2026-09-26T02:50:13.2365819+00:00"],
    ["sem fuso", "2026-09-26T02:50:13.236581"],
    ["data que não existe", "2026-02-30T02:50:13+00:00"],
    ["hora 24", "2026-09-26T24:00:00+00:00"],
    ["só a data", "2026-09-26"],
    ["vazio", ""],
    ["injeção no filtro", "2026-09-26T02:50:13+00:00,id.gt.0"],
  ])("recusa %s", (_, before) => {
    expect(fieldErrors(ticketTimelineQuerySchema.safeParse({ before })).before?.length).toBeGreaterThan(0);
  });

  it("segue isTimelineInstant também no fuso (fonte única com a timeline)", () => {
    // Fuso histórico com segundos: o Postgres o escreve, e a timeline o compara.
    expect(ticketTimelineQuerySchema.parse({ before: "1890-01-01T00:00:00+05:30:15" })).toEqual({
      before: "1890-01-01T00:00:00+05:30:15",
    });
    // Além de ±15:59 o Postgres recusa o fuso, e a timeline lançaria RangeError.
    expect(
      fieldErrors(ticketTimelineQuerySchema.safeParse({ before: "2026-09-26T02:50:13+20:00" })).before
    ).toEqual(["Instante inválido."]);
  });

  it("recusa o beforeId, que saiu do contrato (emenda 2)", () => {
    expect(
      ticketTimelineQuerySchema.safeParse({ before: "2026-09-26T02:50:13+00:00", beforeId: TICKET_ID })
        .success
    ).toBe(false);
  });
});

// Formato real (banco local): jsonb de ticket_summary com `number` numérico e
// instantes com microssegundos.
const summary = {
  id: TICKET_ID,
  title: "Teste erro",
  number: 1219,
  status: "em_atendimento",
  version: 3,
  priority: "media",
  closed_at: null,
  product_id: null,
  updated_at: "2026-09-26T02:50:13.236581+00:00",
  category_id: null,
  contract_id: null,
  customer_id: null,
  resolved_at: null,
  sla_paused_at: null,
  conversation_id: CONVERSATION_ID,
  resolution_due_at: "2026-09-27T02:50:13.236581+00:00",
  first_responded_at: null,
  assigned_to_user_id: USER_ID,
  first_response_due_at: "2026-09-26T06:50:13.236581+00:00",
};

describe("ticketSummarySchema", () => {
  it("aceita o jsonb real e devolve os instantes crus", () => {
    expect(ticketSummarySchema.parse(summary)).toEqual(summary);
  });

  it("confere as 19 chaves de ticket_summary", () => {
    expect(Object.keys(ticketSummarySchema.shape)).toHaveLength(19);
    expect(Object.keys(ticketSummarySchema.shape).sort()).toEqual(Object.keys(summary).sort());
  });

  it.each(["ai_triage", "idempotency_key", "external_id", "conversation_external_id"])(
    "falha alto se o banco começar a devolver %s",
    (key) => {
      expect(ticketSummarySchema.safeParse({ ...summary, [key]: "x" }).success).toBe(false);
    }
  );

  it("recusa chave faltando, status desconhecido e número como texto", () => {
    const withoutVersion: Record<string, unknown> = { ...summary };
    delete withoutVersion.version;

    expect(ticketSummarySchema.safeParse(withoutVersion).success).toBe(false);
    expect(ticketSummarySchema.safeParse({ ...summary, status: "arquivado" }).success).toBe(false);
    expect(ticketSummarySchema.safeParse({ ...summary, number: "1219" }).success).toBe(false);
  });
});
