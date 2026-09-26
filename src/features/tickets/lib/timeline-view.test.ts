import { describe, expect, it } from "vitest";

import {
  buildTimelinePeople,
  commentToTimelineItem,
  eventLines,
  mergeTimelineItems,
  messageSenderLabel,
  messageSummary,
  readTimelinePage,
  statusChangeText,
  timelineItemKey,
  trailActorLabel,
  trailUserLabel,
  type TimelineCatalog,
} from "@/features/tickets/lib/timeline-view";
import type {
  TicketStatusOption,
  TimelineCommentItem,
  TimelineEventItem,
  TimelineItem,
  TimelineMessageItem,
  TimelineStatusItem,
} from "@/features/tickets/types";

const ANA = "11111111-1111-4111-8111-111111111111";
const BRUNO = "22222222-2222-4222-8222-222222222222";
const GONE = "99999999-9999-4999-8999-999999999999";
const QUEUE = "33333333-3333-4333-8333-333333333333";
const ARCHIVED_QUEUE = "44444444-4444-4444-8444-444444444444";
const CATEGORY = "55555555-5555-4555-8555-555555555555";

const USERS = [
  { id: ANA, name: "Ana" },
  { id: BRUNO, name: "Bruno" },
];

// A lista carregada tem sempre quem está vendo; sem ele, a leitura falhou.
const people = buildTimelinePeople(USERS, ANA);
const peopleUnavailable = buildTimelinePeople([], ANA);

function status(overrides: Partial<TimelineStatusItem> = {}): TimelineStatusItem {
  return {
    kind: "status",
    id: "st-1",
    at: "2026-09-26T12:00:00.000001+00:00",
    seq: 1,
    from_status: null,
    to_status: "novo",
    actor_type: "agent",
    actor_user_id: ANA,
    reason: null,
    ...overrides,
  };
}

function event(overrides: Partial<TimelineEventItem> = {}): TimelineEventItem {
  return {
    kind: "event",
    id: "ev-1",
    at: "2026-09-26T12:00:00.000001+00:00",
    seq: 2,
    event_type: "ticket.created",
    actor_type: "agent",
    actor_user_id: ANA,
    metadata: {},
    ...overrides,
  };
}

function comment(overrides: Partial<TimelineCommentItem> = {}): TimelineCommentItem {
  return {
    kind: "comment",
    id: "co-1",
    at: "2026-09-26T12:05:00+00:00",
    author_user_id: ANA,
    author_token_id: null,
    body: "Primeira nota",
    edited_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function message(overrides: Partial<TimelineMessageItem> = {}): TimelineMessageItem {
  return {
    kind: "message",
    id: "me-1",
    at: "2026-09-26T12:01:00+00:00",
    direction: "inbound",
    sender_type: "contact",
    type: "text",
    content: "O sistema caiu",
    file_name: null,
    delivery_status: "delivered",
    sent_by_user_id: null,
    is_deleted: false,
    ...overrides,
  };
}

const ids = (items: TimelineItem[]) => items.map(timelineItemKey);

describe("mergeTimelineItems", () => {
  it("ordena do mais antigo para o mais novo, ao contrário da API", () => {
    const newestFirst: TimelineItem[] = [
      comment({ at: "2026-09-26T12:05:00+00:00" }),
      message({ at: "2026-09-26T12:01:00+00:00" }),
      event({ at: "2026-09-26T12:00:00+00:00", seq: 2 }),
      status({ at: "2026-09-26T12:00:00+00:00", seq: 1 }),
    ];
    expect(ids(mergeTimelineItems([], newestFirst))).toEqual([
      "status:st-1",
      "event:ev-1",
      "message:me-1",
      "comment:co-1",
    ]);
  });

  it("compara no microssegundo e entre fusos, sem passar por Date", () => {
    const later = message({ id: "b", at: "2026-09-26T09:00:00.000002-03:00" });
    const earlier = message({ id: "a", at: "2026-09-26T12:00:00.000001+00:00" });
    expect(ids(mergeTimelineItems([], [later, earlier]))).toEqual(["message:a", "message:b"]);
  });

  it("junta sem duplicar, e a versão que chegou vence (nota editada ou apagada)", () => {
    const current = [comment(), message()];
    const edited = comment({ body: "Nota corrigida", edited_at: "2026-09-26T12:10:00+00:00" });
    const merged = mergeTimelineItems(current, [edited, message()]);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.kind === "comment")).toMatchObject({
      body: "Nota corrigida",
    });
  });

  it("não perde o que a página nova deixou de fora", () => {
    const olderPage = [message({ id: "old", at: "2026-09-25T08:00:00+00:00" })];
    const merged = mergeTimelineItems(olderPage, [comment()]);
    expect(ids(merged)).toEqual(["message:old", "comment:co-1"]);
  });

  it("descarta item com instante fora do formato em vez de quebrar a ordem", () => {
    const broken = message({ id: "x", at: "ontem" });
    expect(ids(mergeTimelineItems([], [broken, comment()]))).toEqual(["comment:co-1"]);
  });

  it("status e evento com o mesmo id não colidem", () => {
    const merged = mergeTimelineItems([], [status({ id: "same" }), event({ id: "same" })]);
    expect(merged).toHaveLength(2);
  });
});

describe("commentToTimelineItem", () => {
  it("vira item da timeline com o created_at no `at`", () => {
    expect(
      commentToTimelineItem({
        id: "c9",
        author_user_id: ANA,
        author_token_id: null,
        body: "Nova",
        created_at: "2026-09-26T13:00:00.5+00:00",
        edited_at: null,
        deleted_at: null,
      })
    ).toEqual({
      kind: "comment",
      id: "c9",
      at: "2026-09-26T13:00:00.5+00:00",
      author_user_id: ANA,
      author_token_id: null,
      body: "Nova",
      edited_at: null,
      deleted_at: null,
    });
  });
});

describe("readTimelinePage", () => {
  it("aceita a página da rota", () => {
    const body = { ok: true, items: [message()], hasMore: true, nextBefore: "2026-09-26T12:01:00+00:00" };
    expect(readTimelinePage(body)).toEqual({
      items: [message()],
      hasMore: true,
      nextBefore: "2026-09-26T12:01:00+00:00",
    });
  });

  it("recusa erro e formato estranho", () => {
    expect(readTimelinePage({ ok: false, message: "falhou" })).toBeNull();
    expect(readTimelinePage(null)).toBeNull();
    expect(readTimelinePage({ ok: true, items: "x", hasMore: false, nextBefore: null })).toBeNull();
    expect(readTimelinePage({ ok: true, items: [], hasMore: false, nextBefore: 1 })).toBeNull();
  });
});

describe("assinatura da trilha", () => {
  it("diz Você, o nome, ou Usuário removido quando a lista carregou", () => {
    expect(trailUserLabel(ANA, people)).toBe("Você");
    expect(trailUserLabel(BRUNO, people)).toBe("Bruno");
    expect(trailUserLabel(GONE, people)).toBe("Usuário removido");
    expect(trailUserLabel(null, people)).toBeNull();
  });

  it("com a lista fora do ar não chama ninguém de removido", () => {
    expect(peopleUnavailable.loaded).toBe(false);
    expect(trailUserLabel(BRUNO, peopleUnavailable)).toBeNull();
    expect(trailActorLabel({ actor_type: "agent", actor_user_id: BRUNO }, peopleUnavailable)).toBe(
      "Analista"
    );
  });

  it("IA, integração e sistema têm rótulo próprio", () => {
    expect(trailActorLabel({ actor_type: "ai", actor_user_id: null }, people)).toBe("IA");
    expect(trailActorLabel({ actor_type: "api", actor_user_id: null }, people)).toBe("Integração");
    expect(trailActorLabel({ actor_type: "system", actor_user_id: null }, people)).toBe(
      "Automático"
    );
  });
});

describe("statusChangeText", () => {
  const statuses: TicketStatusOption[] = [
    {
      key: "resolvido",
      label: "Solucionado",
      color: "emerald",
      position: 6,
      sla_mode: "stopped",
      is_terminal: false,
    },
  ];

  it("usa o rótulo do admin e cai no de recurso", () => {
    expect(
      statusChangeText({ from_status: "em_atendimento", to_status: "resolvido" }, statuses)
    ).toBe("Status: de Em atendimento para Solucionado");
    expect(statusChangeText({ from_status: null, to_status: "novo" }, null)).toBe(
      "Status inicial: Novo"
    );
  });
});

describe("eventLines", () => {
  const catalog: TimelineCatalog = {
    statuses: null,
    products: [{ id: QUEUE, name: "Sistema Fiscal", niche: null, color: "blue", archived_at: null }],
    categories: [
      { id: CATEGORY, name: "Nota fiscal", product_id: QUEUE, parent_id: null, archived_at: null },
    ],
  };

  const lines = (metadata: Record<string, unknown>, eventType: string, p = people) =>
    eventLines(event({ event_type: eventType, metadata }), p, catalog);

  it("abre, atribui, assume e tira o responsável", () => {
    expect(lines({ source: "agent" }, "ticket.created")).toEqual(["Ticket aberto"]);
    expect(lines({ from: null, to: BRUNO }, "ticket.assigned")).toEqual(["Responsável: Bruno"]);
    expect(lines({ from: BRUNO, to: ANA, via: "take_over" }, "ticket.assigned")).toEqual([
      "Assumiu o ticket",
    ]);
    expect(lines({ from: BRUNO, to: null }, "ticket.assigned")).toEqual(["Responsável removido"]);
    expect(lines({ from: null, to: BRUNO }, "ticket.assigned", peopleUnavailable)).toEqual([
      "Responsável alterado",
    ]);
  });

  it("foco na conversa e mensagens vinculadas", () => {
    expect(lines({ previous: null }, "ticket.focused")).toEqual(["Ticket em foco na conversa"]);
    expect(lines({ reason: "terminal" }, "ticket.unfocused")).toEqual([
      "Saiu do foco da conversa ao ser encerrado",
    ]);
    expect(lines({ next: QUEUE }, "ticket.unfocused")).toEqual(["Saiu do foco da conversa"]);
    expect(lines({ count: 1 }, "ticket.messages_linked")).toEqual([
      "1 mensagem da conversa vinculada ao ticket",
    ]);
    expect(lines({ count: 12 }, "ticket.messages_linked")).toEqual([
      "12 mensagens da conversa vinculadas ao ticket",
    ]);
  });

  it("edição lista cada campo, com nome da fila ativa e genérico na arquivada", () => {
    // jsonb_strip_nulls: o `from` nulo não vem.
    expect(
      lines(
        {
          changes: {
            title: { from: "Erro", to: "Erro ao emitir nota" },
            description: { changed: true },
            priority: { from: "media", to: "alta" },
            product_id: { to: QUEUE },
            category_id: { from: CATEGORY },
            customer_id: { to: GONE },
            contract_id: { to: GONE },
          },
        },
        "ticket.updated"
      )
    ).toEqual([
      "Título alterado para “Erro ao emitir nota”",
      "Descrição editada",
      "Prioridade: de Média para Alta",
      "Fila: Sistema Fiscal",
      "Categoria removida",
      "Empresa definida",
    ]);
    expect(
      lines({ changes: { product_id: { from: QUEUE, to: ARCHIVED_QUEUE } } }, "ticket.updated")
    ).toEqual(["Fila alterada"]);
    expect(lines({ changes: { contract_id: { from: GONE } } }, "ticket.updated")).toEqual([
      "Contrato desvinculado",
    ]);
  });

  it("nenhum texto vaza id cru, e o tipo desconhecido vira frase genérica", () => {
    const all = [
      ...lines({ from: null, to: GONE }, "ticket.assigned"),
      ...lines({ next: GONE }, "ticket.unfocused"),
      ...lines({ changes: { customer_id: { from: GONE, to: QUEUE } } }, "ticket.updated"),
      ...lines({ foo: GONE }, "ticket.sla_breached"),
    ];
    expect(all).toEqual([
      "Responsável: Usuário removido",
      "Saiu do foco da conversa",
      "Empresa alterada",
      "Atividade registrada",
    ]);
    for (const line of all) expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe("mensagem compacta", () => {
  it("remetente de cada origem", () => {
    expect(messageSenderLabel({ sender_type: "contact" })).toBe("Cliente");
    expect(messageSenderLabel({ sender_type: "ai" })).toBe("IA");
    expect(messageSenderLabel({ sender_type: "agent" })).toBe("Analista");
    expect(messageSenderLabel({ sender_type: "device" })).toBe("Celular da empresa");
  });

  it("resume texto, mídia com legenda, documento pelo nome e esconde o vCard", () => {
    expect(messageSummary(message())).toEqual({ media: null, text: "O sistema caiu", deleted: false });
    expect(messageSummary(message({ type: "image", content: "print do erro" }))).toEqual({
      media: "Imagem",
      text: "print do erro",
      deleted: false,
    });
    expect(
      messageSummary(message({ type: "document", content: "segue", file_name: "log.txt" }))
    ).toEqual({ media: "Documento", text: "log.txt", deleted: false });
    expect(messageSummary(message({ type: "contact", content: "BEGIN:VCARD" }))).toEqual({
      media: "Contato",
      text: null,
      deleted: false,
    });
    expect(messageSummary(message({ is_deleted: true }))).toEqual({
      media: null,
      text: null,
      deleted: true,
    });
  });
});
