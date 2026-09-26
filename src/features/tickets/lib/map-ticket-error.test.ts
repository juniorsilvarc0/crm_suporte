// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TICKET_CATALOG_ERROR_NEEDLES,
  TICKET_ERROR_TAGS,
  catalogErrorBody,
  mapCatalogError,
  mapTicketError,
} from "@/features/tickets/lib/map-ticket-error";
import { ticketErrorBody, ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import type { TicketError } from "@/features/tickets/types";

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");
const TICKETS_SQL = readFileSync(path.join(MIGRATIONS, "20260925120900_tickets.sql"), "utf8");
const CADASTROS_SQL = readFileSync(path.join(MIGRATIONS, "20260925120700_cadastros.sql"), "utf8");

const USER_ID = "34f544d9-b6ee-4119-9905-23d4e63e7611";
const INTERNAL = { status: 500, code: "internal", message: "Não foi possível concluir a operação." };

// Mensagens no formato real (conferido no banco local): RPC/trigger levanta só a
// TAG (P0001), com os extras no DETAIL/HINT; o Postgres cita a constraint entre
// aspas nos erros 23505/23514/23503.
const tag = (message: string, extra: { details?: string | null; hint?: string | null } = {}) => ({
  code: "P0001",
  message,
  details: null,
  hint: null,
  ...extra,
});
const unique = (name: string) => ({
  code: "23505",
  message: `duplicate key value violates unique constraint "${name}"`,
});
const check = (table: string, name: string) => ({
  code: "23514",
  message: `new row for relation "${table}" violates check constraint "${name}"`,
});

// As TAGs de tempo de execução: 'TAG' sozinha, maiúscula. Ficam de fora as
// 'TICKETS: …' (asserções da própria migration) e 'conversation_not_found'
// (clear_chat_conversation, traduzida pela rota do chat).
function migrationTags(): Set<string> {
  return new Set(
    [...TICKETS_SQL.matchAll(/raise exception '([A-Z][A-Z0-9_]*)'/g)].map((match) => match[1] ?? "")
  );
}

describe("mapTicketError — as TAGs da migration", () => {
  it("cobre exatamente as TAGs levantadas em 20260925120900_tickets.sql", () => {
    const fromSql = migrationTags();

    expect(fromSql.size).toBeGreaterThan(30);
    expect(new Set(TICKET_ERROR_TAGS)).toEqual(fromSql);
    expect(TICKET_ERROR_TAGS).toHaveLength(fromSql.size);
  });

  it("nenhuma TAG é trecho de outra (a leitura é por includes)", () => {
    const clashes = TICKET_ERROR_TAGS.flatMap((a) =>
      TICKET_ERROR_TAGS.filter((b) => a !== b && b.includes(a)).map((b) => `${a} ⊂ ${b}`)
    );

    expect(clashes).toEqual([]);
  });
});

// [TAG, status, code, campo]: o resultado esperado de cada ramo do mapa.
const TAG_CASES: ReadonlyArray<readonly [string, number, string, string | undefined]> = [
  ["INVALID_TRANSITION", 409, "invalid_transition", undefined],
  ["VERSION_CONFLICT", 409, "version_conflict", undefined],
  ["ALREADY_ASSIGNED", 409, "already_assigned", undefined],
  ["TICKET_TERMINAL", 409, "ticket_terminal", undefined],
  ["CONVERSATION_HAS_TICKETS", 409, "conversation_has_tickets", undefined],
  ["IDEMPOTENCY_KEY_REUSED", 409, "idempotency_key_reused", undefined],
  ["COMMENT_DELETED", 409, "comment_deleted", undefined],
  ["TICKET_NOT_FOUND", 404, "not_found", undefined],
  ["CONVERSATION_NOT_FOUND", 404, "not_found", undefined],
  ["PRODUCT_NOT_FOUND", 422, "product_not_found", "product_id"],
  ["PRODUCT_ARCHIVED", 422, "product_archived", "product_id"],
  ["CATEGORY_NOT_FOUND", 422, "category_not_found", "category_id"],
  ["CATEGORY_ARCHIVED", 422, "category_archived", "category_id"],
  ["CATEGORY_PRODUCT_MISMATCH", 422, "category_product_mismatch", "category_id"],
  ["CATEGORY_TOO_DEEP", 422, "category_too_deep", undefined],
  ["CATEGORY_HAS_ACTIVE_CHILDREN", 422, "category_has_active_children", undefined],
  ["CUSTOMER_NOT_FOUND", 422, "customer_not_found", "customer_id"],
  ["CUSTOMER_ARCHIVED", 422, "customer_archived", "customer_id"],
  ["ASSIGNEE_INACTIVE", 422, "assignee_inactive", "assignee_id"],
  ["TICKET_NOT_IN_CONVERSATION", 422, "ticket_not_in_conversation", "ticket_id"],
  ["REASON_REQUIRED", 422, "reason_required", "reason"],
  ["INVALID_PATCH", 400, "validation", undefined],
  ["INVALID_STATUS", 400, "validation", "to"],
  ["INVALID_INITIAL_STATUS", 400, "validation", undefined],
  ["INVALID_PRIORITY", 400, "validation", "priority"],
  ["INVALID_SOURCE", 400, "validation", undefined],
  ["INVALID_ASSIGNEE", 400, "validation", undefined],
  ["FORBIDDEN", 403, "forbidden", undefined],
  ["INVALID_ACTOR", 500, "internal", undefined],
  ["ACTIVE_TICKET_READ_ONLY", 500, "internal", undefined],
  ["TICKET_IMMUTABLE", 500, "internal", undefined],
  ["TICKET_LOG_APPEND_ONLY", 500, "internal", undefined],
];

describe("mapTicketError — TAG das RPCs e triggers", () => {
  it("a tabela deste teste tem um caso para cada TAG do mapa", () => {
    expect(new Set(TAG_CASES.map(([name]) => name))).toEqual(new Set(TICKET_ERROR_TAGS));
  });

  it.each(TAG_CASES)("%s → %i %s", (name, status, code, field) => {
    const mapped = mapTicketError(tag(name));

    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
    expect(mapped.field).toBe(field);
    expect(mapped.message).not.toContain(name);
  });

  it("TICKET_LOG_APPEND_ONLY vem com errcode 0A000 e continua 500", () => {
    expect(mapTicketError({ code: "0A000", message: "TICKET_LOG_APPEND_ONLY" })).toEqual(INTERNAL);
  });
});

describe("mapTicketError — extras do DETAIL e do HINT", () => {
  it("INVALID_TRANSITION: permitidos do DETAIL (jsonb) e status atual do HINT", () => {
    const mapped = mapTicketError(
      tag("INVALID_TRANSITION", {
        details: '["aguardando_cliente", "aguardando_interno", "resolvido", "cancelado"]',
        hint: "em_atendimento",
      })
    );

    expect(mapped).toEqual({
      status: 409,
      code: "invalid_transition",
      message: "Esse movimento não é permitido a partir do status atual.",
      allowed: ["aguardando_cliente", "aguardando_interno", "resolvido", "cancelado"],
      current: "em_atendimento",
    });
  });

  it("INVALID_TRANSITION de um terminal: nenhum destino, lista vazia", () => {
    const mapped = mapTicketError(tag("INVALID_TRANSITION", { details: "[]", hint: "fechado" }));

    expect(mapped.allowed).toEqual([]);
    expect(mapped.current).toBe("fechado");
  });

  it("INVALID_TRANSITION do guard (só HINT): sem allowed, com current", () => {
    const mapped = mapTicketError(tag("INVALID_TRANSITION", { hint: "resolvido" }));

    expect(mapped).not.toHaveProperty("allowed");
    expect(mapped.current).toBe("resolvido");
  });

  it.each([
    ["JSON quebrado", "[em_triagem"],
    ["objeto em vez de lista", '{"a":1}'],
    ["status desconhecido", '["em_triagem", "arquivado"]'],
    ["texto solto", "Informe o motivo."],
  ])("INVALID_TRANSITION com DETAIL inválido (%s): continua 409, sem allowed", (_, details) => {
    const mapped = mapTicketError(tag("INVALID_TRANSITION", { details, hint: "novo" }));

    expect(mapped.status).toBe(409);
    expect(mapped).not.toHaveProperty("allowed");
    expect(mapped.current).toBe("novo");
  });

  it.each(["constructor", "Novo", "", "em_atendimento "])(
    "INVALID_TRANSITION com HINT fora das chaves (%j): sem current",
    (hint) => {
      expect(mapTicketError(tag("INVALID_TRANSITION", { details: "[]", hint }))).not.toHaveProperty(
        "current"
      );
    }
  );

  it("VERSION_CONFLICT: versão atual do DETAIL", () => {
    expect(mapTicketError(tag("VERSION_CONFLICT", { details: "3" }))).toEqual({
      status: 409,
      code: "version_conflict",
      message: "O ticket mudou em outro lugar. Recarregue para ver a versão atual.",
      currentVersion: 3,
    });
  });

  it.each([null, "", "0", "-1", "3.5", "abc", "007", "12345678901"])(
    "VERSION_CONFLICT com DETAIL inválido (%j): sem currentVersion",
    (details) => {
      const mapped = mapTicketError(tag("VERSION_CONFLICT", { details }));

      expect(mapped.code).toBe("version_conflict");
      expect(mapped).not.toHaveProperty("currentVersion");
    }
  );

  it("ALREADY_ASSIGNED: quem está com o ticket, do DETAIL", () => {
    expect(mapTicketError(tag("ALREADY_ASSIGNED", { details: USER_ID }))).toEqual({
      status: 409,
      code: "already_assigned",
      message: "Este ticket já está com outro analista.",
      assignedToUserId: USER_ID,
    });
  });

  it.each([null, "", "Ana", `${USER_ID}\n`])(
    "ALREADY_ASSIGNED com DETAIL que não é uuid (%j): sem assignedToUserId",
    (details) => {
      expect(mapTicketError(tag("ALREADY_ASSIGNED", { details }))).not.toHaveProperty(
        "assignedToUserId"
      );
    }
  );

  it("os extras só saem da TAG deles: DETAIL de REASON_REQUIRED não vira nada", () => {
    expect(
      mapTicketError(tag("REASON_REQUIRED", { details: "Informe o motivo do cancelamento." }))
    ).toEqual({
      status: 422,
      code: "reason_required",
      message: "Informe o motivo do cancelamento.",
      field: "reason",
    });
  });
});

describe("mapTicketError — constraint na message", () => {
  it.each([
    [check("tickets", "tickets_title_check"), 400, "validation", "title"],
    [check("tickets", "tickets_description_check"), 400, "validation", "description"],
    [
      check("ticket_status_history", "ticket_status_history_reason_check"),
      400,
      "validation",
      "reason",
    ],
    [check("tickets", "tickets_idempotency_key_check"), 400, "validation", "idempotency_key"],
    [check("tickets", "tickets_external_id_check"), 400, "validation", undefined],
    [check("tickets", "tickets_ai_triage_check"), 400, "validation", undefined],
    [check("ticket_comments", "ticket_comments_body_check"), 400, "validation", undefined],
    [check("ticket_attachments", "ticket_attachments_file_name_check"), 400, "validation", undefined],
    [check("ticket_attachments", "ticket_attachments_mime_check"), 400, "validation", undefined],
    [check("ticket_attachments", "ticket_attachments_size_check"), 400, "validation", undefined],
    [check("ticket_categories", "ticket_categories_name_check"), 400, "validation", undefined],
    [check("ticket_statuses", "ticket_statuses_label_check"), 400, "validation", undefined],
    [check("ticket_statuses", "ticket_statuses_color_check"), 400, "validation", undefined],
    [check("sla_policies", "sla_policies_first_response_check"), 400, "validation", undefined],
    [check("sla_policies", "sla_policies_resolution_check"), 400, "validation", undefined],
    [check("sla_policies", "sla_policies_order_check"), 400, "validation", undefined],
    [check("sla_policies", "sla_policies_warn_pct_check"), 400, "validation", undefined],
    [unique("ticket_statuses_label_uidx"), 409, "duplicate", undefined],
    [unique("ticket_categories_name_active_uidx"), 409, "duplicate", undefined],
    [unique("products_name_active_uidx"), 409, "duplicate", undefined],
    [
      {
        code: "23503",
        message:
          'insert or update on table "ticket_categories" violates foreign key constraint "ticket_categories_parent_id_fkey"',
      },
      422,
      "category_not_found",
      undefined,
    ],
    [
      {
        code: "23503",
        message:
          'insert or update on table "ticket_categories" violates foreign key constraint "ticket_categories_product_id_fkey"',
      },
      422,
      "product_not_found",
      "product_id",
    ],
  ])("%o → %i %s", (error, status, code, field) => {
    const mapped = mapTicketError(error);

    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
    expect(mapped.field).toBe(field);
  });

  it("toda constraint do mapa existe nas migrations (erro de digitação nunca casaria)", () => {
    const names = [
      "tickets_title_check",
      "tickets_description_check",
      "ticket_status_history_reason_check",
      "tickets_idempotency_key_check",
      "tickets_external_id_check",
      "tickets_ai_triage_check",
      "ticket_comments_body_check",
      "ticket_attachments_file_name_check",
      "ticket_attachments_mime_check",
      "ticket_attachments_size_check",
      "ticket_categories_name_check",
      "ticket_statuses_label_check",
      "ticket_statuses_color_check",
      "sla_policies_first_response_check",
      "sla_policies_resolution_check",
      "sla_policies_order_check",
      "sla_policies_warn_pct_check",
      "ticket_statuses_label_uidx",
      "ticket_categories_name_active_uidx",
      "ticket_categories_parent_id_fkey",
      "ticket_categories_product_id_fkey",
    ];

    expect(names.filter((name) => !TICKETS_SQL.includes(name))).toEqual([]);
    expect(CADASTROS_SQL).toContain("products_name_active_uidx");
  });

  it("a mensagem do título diz o que corrigir, sem citar o banco", () => {
    expect(mapTicketError(check("tickets", "tickets_title_check"))).toEqual({
      status: 400,
      code: "validation",
      message: "Use de 3 a 200 caracteres no título.",
      field: "title",
    });
  });
});

describe("mapTicketError — code", () => {
  it("42501 sem TAG é bug (grant faltando): 500, nunca 403", () => {
    expect(
      mapTicketError({ code: "42501", message: "permission denied for table tickets" })
    ).toEqual(INTERNAL);
  });

  it.each(["22P02", "22003", "22008", "22P05", "23502"])("%s → 400 validation", (code) => {
    expect(mapTicketError({ code, message: "qualquer" })).toEqual({
      status: 400,
      code: "validation",
      message: "Revise os campos destacados.",
    });
  });

  it("constraint de invariante é bug: 500, não 400", () => {
    expect(mapTicketError(check("tickets", "tickets_sla_clock_check"))).toEqual(INTERNAL);
    expect(mapTicketError(check("tickets", "tickets_resolution_due_check"))).toEqual(INTERNAL);
    expect(
      mapTicketError(check("ticket_status_history", "ticket_status_history_actor_check"))
    ).toEqual(INTERNAL);
  });

  it("cai em 500 para o resto, inclusive único que o mapa não conhece", () => {
    expect(mapTicketError(unique("tickets_user_idempotency_key")).status).toBe(500);
    expect(mapTicketError({ code: "40P01", message: "deadlock detected" }).status).toBe(500);
    expect(mapTicketError({ code: "PGRST202", message: "Could not find the function" }).status).toBe(
      500
    );
    // JSON que o próprio serviço serializou e o PostgREST não leu: bug, não entrada.
    expect(mapTicketError({ code: "PGRST102", message: "Empty or invalid json" }).status).toBe(500);
    expect(mapTicketError({ message: "fetch failed" }).status).toBe(500);
    expect(mapTicketError(null)).toEqual(INTERNAL);
    expect(mapTicketError(undefined)).toEqual(INTERNAL);
  });
});

describe("mapTicketError — ordem de leitura", () => {
  it("TAG vence o code: FORBIDDEN com 42501 continua 403", () => {
    expect(mapTicketError({ code: "42501", message: "FORBIDDEN" }).status).toBe(403);
  });

  it("TAG vence a constraint", () => {
    expect(
      mapTicketError({ code: "P0001", message: 'CUSTOMER_ARCHIVED (via "tickets_title_check")' })
        .code
    ).toBe("customer_archived");
  });

  it("constraint vence o code: 23514 do título é 400 com campo, não 500", () => {
    expect(mapTicketError(check("tickets", "tickets_title_check")).field).toBe("title");
  });

  it("INVALID_STATUS não é lido como INVALID_INITIAL_STATUS, nem o contrário", () => {
    expect(mapTicketError(tag("INVALID_STATUS")).field).toBe("to");
    expect(mapTicketError(tag("INVALID_INITIAL_STATUS")).message).toBe("Status inicial inválido.");
  });

  it("devolve uma cópia: alterar a resposta não altera a próxima", () => {
    const first = mapTicketError(tag("TICKET_NOT_FOUND"));
    first.message = "alterada";
    const internal = mapTicketError(tag("INVALID_ACTOR"));
    internal.code = "alterado";

    expect(mapTicketError(tag("TICKET_NOT_FOUND")).message).toBe("Ticket não encontrado.");
    expect(mapTicketError(tag("INVALID_ACTOR"))).toEqual(INTERNAL);
    expect(mapTicketError(null)).toEqual(INTERNAL);
  });
});

describe("ticketErrorResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde o corpo de negócio com os extras em snake_case", async () => {
    const error = mapTicketError(
      tag("INVALID_TRANSITION", { details: '["em_atendimento", "fechado"]', hint: "resolvido" })
    );
    const response = ticketErrorResponse("[POST /api/tickets/[id]/transition]", error);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: "invalid_transition",
      message: "Esse movimento não é permitido a partir do status atual.",
      allowed: ["em_atendimento", "fechado"],
      current: "resolvido",
    });
  });

  it("current_version e assigned_to_user_id saem com o nome da API", () => {
    expect(ticketErrorBody(mapTicketError(tag("VERSION_CONFLICT", { details: "7" })))).toMatchObject(
      { code: "version_conflict", current_version: 7 }
    );
    expect(
      ticketErrorBody(mapTicketError(tag("ALREADY_ASSIGNED", { details: USER_ID })))
    ).toMatchObject({ code: "already_assigned", assigned_to_user_id: USER_ID });
  });

  it("marca o campo em errors, com a própria mensagem", async () => {
    const response = ticketErrorResponse("[rota]", mapTicketError(tag("PRODUCT_ARCHIVED")));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      code: "product_archived",
      message: "Fila arquivada. Escolha outra.",
      errors: { product_id: ["Fila arquivada. Escolha outra."] },
    });
  });

  it("não loga erro de negócio", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    ticketErrorResponse("[rota]", mapTicketError(tag("VERSION_CONFLICT", { details: "2" })));

    expect(log).not.toHaveBeenCalled();
  });

  it("loga o 500 com a rota e a causa, e nunca a devolve ao cliente", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = { code: "42501", message: "permission denied for table tickets" };

    const response = ticketErrorResponse("[PATCH /api/tickets/[id]]", mapTicketError(cause), cause);
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, code: INTERNAL.code, message: INTERNAL.message });
    expect(JSON.stringify(body)).not.toContain("permission");
    expect(log).toHaveBeenCalledWith(
      "[PATCH /api/tickets/[id]]",
      "42501",
      "permission denied for table tickets"
    );
  });

  it("sem a causa (erro vindo do serviço), loga o code do mapa", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error: TicketError = { status: 500, code: "internal", message: "Não foi possível." };

    ticketErrorResponse("[POST /api/tickets]", error);

    expect(log).toHaveBeenCalledWith("[POST /api/tickets]", "internal", "Não foi possível.");
  });
});

describe("mapCatalogError — rotas de catálogo (4f)", () => {
  it("toda TAG e constraint dos overrides existe no mapa e nas migrations", () => {
    const missing = TICKET_CATALOG_ERROR_NEEDLES.filter(
      (needle) =>
        !TICKET_ERROR_TAGS.includes(needle) &&
        !TICKETS_SQL.includes(needle) &&
        !CADASTROS_SQL.includes(needle)
    );

    expect(TICKET_CATALOG_ERROR_NEEDLES.length).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it("todo override cai num erro de negócio, nunca no 500 (campo em bug esconderia o log)", () => {
    const internal = TICKET_CATALOG_ERROR_NEEDLES.filter(
      (needle) => mapTicketError({ code: "P0001", message: needle }).status >= 500
    );

    expect(internal).toEqual([]);
  });

  it("as checks da fila (migration _cadastros) são 400, não 500", () => {
    for (const name of ["products_name_check", "products_niche_check", "products_color_format_check"]) {
      expect(CADASTROS_SQL).toContain(name);
      expect(mapTicketError(check("products", name))).toMatchObject({
        status: 400,
        code: "validation",
      });
    }
    expect(mapCatalogError(check("products", "products_niche_check"), "product")).toEqual({
      status: 400,
      code: "validation",
      message: "Use até 80 caracteres no nicho, ou deixe em branco.",
      field: "niche",
    });
  });

  it.each([
    ["product", unique("products_name_active_uidx"), "name", "Já existe uma fila com este nome."],
    [
      "category_create",
      unique("ticket_categories_name_active_uidx"),
      "name",
      "Já existe uma categoria com este nome.",
    ],
    [
      "category_update",
      unique("ticket_categories_name_active_uidx"),
      "name",
      "Já existe uma categoria com este nome.",
    ],
    ["ticket_status", unique("ticket_statuses_label_uidx"), "label", "Já existe um status com este rótulo."],
  ] as const)("%s: nome repetido → 409 duplicate no campo %s", (context, error, field, message) => {
    expect(mapCatalogError(error, context)).toEqual({ status: 409, code: "duplicate", message, field });
  });

  it("CATEGORY_ARCHIVED: a mãe arquivada, no campo de cada formulário", () => {
    expect(mapCatalogError(tag("CATEGORY_ARCHIVED"), "category_create")).toEqual({
      status: 422,
      code: "category_archived",
      message: "Categoria mãe arquivada. Reative-a antes.",
      field: "parent_id",
    });
    expect(mapCatalogError(tag("CATEGORY_ARCHIVED"), "category_update")).toMatchObject({
      status: 422,
      message: "Categoria mãe arquivada. Reative-a antes.",
      field: "archived",
    });
  });

  it("as regras do trigger de categorias marcam o campo do formulário", () => {
    expect(mapCatalogError(tag("CATEGORY_TOO_DEEP"), "category_create")).toEqual({
      status: 422,
      code: "category_too_deep",
      message: "Categoria tem no máximo dois níveis.",
      field: "parent_id",
    });
    expect(mapCatalogError(tag("CATEGORY_PRODUCT_MISMATCH"), "category_create")).toMatchObject({
      code: "category_product_mismatch",
      field: "parent_id",
    });
    expect(mapCatalogError(tag("PRODUCT_ARCHIVED"), "category_create")).toMatchObject({
      code: "product_archived",
      message: "Fila arquivada. Reative-a antes.",
      field: "product_id",
    });
    expect(mapCatalogError(tag("CATEGORY_HAS_ACTIVE_CHILDREN"), "category_update")).toEqual({
      status: 422,
      code: "category_has_active_children",
      message: "Arquive as subcategorias antes da categoria.",
      field: "archived",
    });
    expect(mapCatalogError(tag("PRODUCT_ARCHIVED"), "category_update")).toEqual({
      status: 422,
      code: "product_archived",
      message: "Fila arquivada. Reative a fila antes.",
      field: "archived",
    });
  });

  it("FK da mãe e da fila: 422 no campo, sem citar o banco", () => {
    const fk = (name: string) => ({
      code: "23503",
      message: `insert or update on table "ticket_categories" violates foreign key constraint "${name}"`,
    });

    expect(mapCatalogError(fk("ticket_categories_parent_id_fkey"), "category_create")).toEqual({
      status: 422,
      code: "category_not_found",
      message: "Categoria mãe não encontrada.",
      field: "parent_id",
    });
    expect(mapCatalogError(fk("ticket_categories_product_id_fkey"), "category_create")).toEqual({
      status: 422,
      code: "product_not_found",
      message: "Fila não encontrada.",
      field: "product_id",
    });
  });

  it("SLA: a ordem do banco (um só campo no corpo) marca a 1ª resposta", () => {
    expect(mapCatalogError(check("sla_policies", "sla_policies_order_check"), "sla_policy")).toEqual(
      {
        status: 400,
        code: "validation",
        message: "A 1ª resposta não pode ter prazo maior que a solução.",
        field: "first_response_minutes",
      }
    );
    expect(
      mapCatalogError(check("sla_policies", "sla_policies_warn_pct_check"), "sla_policy")
    ).toMatchObject({ field: "warn_pct", message: "Use de 1 a 99%." });
  });

  it("o campo de ticket do mapa não passa para o catálogo", () => {
    expect(mapCatalogError(tag("CATEGORY_ARCHIVED"), "sla_policy")).toEqual({
      status: 422,
      code: "category_archived",
      message: "Categoria arquivada. Escolha outra.",
    });
  });

  it("TAG vence a constraint também no catálogo: o campo é o da TAG", () => {
    const both = {
      code: "P0001",
      message: 'CATEGORY_ARCHIVED (via "ticket_categories_name_check")',
    };

    expect(mapCatalogError(both, "category_create")).toMatchObject({
      code: "category_archived",
      field: "parent_id",
    });
    expect(mapCatalogError(both, "category_update")).toMatchObject({
      code: "category_archived",
      field: "archived",
    });
  });

  it("o override é do contexto: a constraint de outro formulário não marca campo", () => {
    expect(mapCatalogError(unique("ticket_statuses_label_uidx"), "product")).not.toHaveProperty(
      "field"
    );
  });

  it("500 continua 500, sem campo e sem a mensagem do banco", () => {
    const cause = { code: "42501", message: "permission denied for table products" };

    expect(mapCatalogError(cause, "product")).toEqual(INTERNAL);
    expect(mapCatalogError(null, "ticket_status")).toEqual(INTERNAL);
  });
});

describe("catalogErrorBody", () => {
  const ITEM = { id: USER_ID, name: "Financeiro" };

  it("marca o campo e leva o item existente no 409", () => {
    const body = catalogErrorBody(
      mapCatalogError(unique("ticket_categories_name_active_uidx"), "category_create"),
      ITEM
    );

    expect(body).toEqual({
      ok: false,
      code: "duplicate",
      message: "Já existe uma categoria com este nome.",
      errors: { name: ["Já existe uma categoria com este nome."] },
      item: ITEM,
    });
  });

  it("sem campo nem item, as chaves somem do JSON", () => {
    const body = catalogErrorBody(mapCatalogError({ code: "57014", message: "timeout" }, "product"));

    expect(JSON.parse(JSON.stringify(body))).toEqual({
      ok: false,
      code: "internal",
      message: "Não foi possível concluir a operação.",
    });
  });
});
