import { describe, expect, it } from "vitest";

import {
  buildTicketTimeline,
  compareInstants,
  compareTimelineItems,
  isTimelineInstant,
  sortTimelineNewestFirst,
  type TimelineSource,
} from "@/features/tickets/lib/ticket-timeline";
import type {
  TimelineAttachmentItem,
  TimelineCommentItem,
  TimelineEventItem,
  TimelineItem,
  TimelineMessageItem,
  TimelineStatusItem,
} from "@/features/tickets/types";

// Instantes no formato do PostgREST: fração sem zeros à direita, fuso +00:00.
const T = (clock: string) => `2026-09-25T12:${clock}+00:00`;

const message = (id: string, at: string): TimelineMessageItem => ({
  kind: "message",
  id,
  at,
  direction: "inbound",
  sender_type: "contact",
  type: "text",
  content: "Não consigo emitir a nota.",
  file_name: null,
  delivery_status: "delivered",
  sent_by_user_id: null,
  is_deleted: false,
});

const comment = (id: string, at: string): TimelineCommentItem => ({
  kind: "comment",
  id,
  at,
  author_user_id: "u1",
  author_token_id: null,
  body: "Reproduzi no ambiente de teste.",
  edited_at: null,
  deleted_at: null,
});

const attachment = (id: string, at: string): TimelineAttachmentItem => ({
  kind: "attachment",
  id,
  at,
  file_name: "log.txt",
  mime: "text/plain",
  size_bytes: 120,
  uploaded_by_user_id: "u1",
  uploaded_by_token_id: null,
});

const status = (id: string, at: string, seq: number): TimelineStatusItem => ({
  kind: "status",
  id,
  at,
  seq,
  from_status: "novo",
  to_status: "em_atendimento",
  actor_type: "agent",
  actor_user_id: "u1",
  reason: null,
});

const event = (id: string, at: string, seq: number): TimelineEventItem => ({
  kind: "event",
  id,
  at,
  seq,
  event_type: "ticket.assigned",
  actor_type: "agent",
  actor_user_id: "u1",
  metadata: { from: null, to: "u1" },
});

const ids = (items: readonly TimelineItem[]) => items.map((item) => item.id);
const source = (items: TimelineItem[], hitLimit = false): TimelineSource => ({ items, hitLimit });

describe("isTimelineInstant", () => {
  it.each([
    "2026-09-26T02:45:57.194405+00:00",
    "2026-09-26T02:45:57.1944+00:00",
    "2026-09-26T02:45:57+00:00",
    "2026-09-26T02:45:57.123Z",
    "2026-09-25T23:45:57.1-03:00",
    "2026-09-26T08:15:57+05:30",
    "1890-01-01T00:00:00-03:06:28",
    "2028-02-29T00:00:00+00:00",
  ])("aceita %s", (value) => {
    expect(isTimelineInstant(value)).toBe(true);
  });

  it.each([
    ["vazio", ""],
    ["só a data", "2026-09-26"],
    ["texto do psql", "2026-09-26 02:45:57.194405+00"],
    ["sem fuso", "2026-09-26T02:45:57.194405"],
    ["7 casas (o Postgres arredondaria)", "2026-09-26T02:45:57.1234567+00:00"],
    ["ponto sem fração", "2026-09-26T02:45:57.+00:00"],
    ["'+' decodificado como espaço na URL", "2026-09-26T02:45:57.194405 00:00"],
    ["30 de fevereiro", "2026-02-30T00:00:00+00:00"],
    ["29/02 fora de ano bissexto", "2026-02-29T00:00:00+00:00"],
    ["mês 13", "2026-13-01T00:00:00+00:00"],
    ["24:00", "2026-09-26T24:00:00+00:00"],
    ["minuto 60", "2026-09-26T12:60:00+00:00"],
    ["segundo 60", "2026-09-26T12:00:60+00:00"],
    ["fuso +16", "2026-09-26T12:00:00+16:00"],
    ["espaço antes", " 2026-09-26T12:00:00Z"],
    ["quebra de linha depois", "2026-09-26T12:00:00Z\n"],
    ["z minúsculo", "2026-09-26T12:00:00z"],
  ])("recusa %s", (_label, value) => {
    expect(isTimelineInstant(value)).toBe(false);
  });

  it("recusa o que não é string", () => {
    for (const value of [null, undefined, 1727268357194, new Date(), ["2026-09-26T02:45:57Z"]]) {
      expect(isTimelineInstant(value)).toBe(false);
    }
  });
});

describe("compareInstants", () => {
  it("empata o mesmo instante escrito com frações de tamanhos diferentes", () => {
    expect(compareInstants(T("00:57.5"), T("00:57.500000"))).toBe(0);
    expect(compareInstants(T("00:57.1944"), T("00:57.194400"))).toBe(0);
    expect(compareInstants(T("00:57"), T("00:57.000000"))).toBe(0);
  });

  it("separa instantes a 1 µs, que o Date empata", () => {
    const a = T("00:57.194405");
    const b = T("00:57.194406");
    expect(Date.parse(a)).toBe(Date.parse(b));
    expect(compareInstants(a, b)).toBe(-1);
    expect(compareInstants(b, a)).toBe(1);
  });

  it("compara pelo valor da fração, não pelo tamanho do texto", () => {
    expect(compareInstants(T("00:57"), T("00:57.000001"))).toBe(-1);
    expect(compareInstants(T("00:57.2"), T("00:57.199999"))).toBe(1);
    expect(compareInstants(T("00:57.19"), T("00:57.1944"))).toBe(-1);
  });

  it("atravessa segundo, dia e fuso", () => {
    expect(compareInstants("2026-09-25T23:59:59.999999+00:00", "2026-09-26T00:00:00+00:00")).toBe(-1);
    expect(compareInstants("2026-09-25T23:45:57.1-03:00", "2026-09-26T02:45:57.100000+00:00")).toBe(0);
    expect(compareInstants("2026-09-26T02:45:57.1Z", "2026-09-26T02:45:57.100000+00:00")).toBe(0);
    expect(compareInstants("2026-09-26T08:15:57+05:30", "2026-09-26T02:45:57+00:00")).toBe(0);
  });

  it("lança RangeError com instante fora do formato", () => {
    expect(() => compareInstants(T("00:57"), "2026-09-26")).toThrow(RangeError);
    expect(() => compareInstants("ontem", T("00:57"))).toThrow(RangeError);
  });
});

describe("ordem da união", () => {
  it("no mesmo instante: mensagem < comentário < anexo < status/evento, estes por seq", () => {
    const at = T("00:10.5");
    const shuffled = [
      status("s12", at, 12),
      comment("c1", at),
      event("e13", at, 13),
      message("m1", at),
      event("e11", at, 11),
      attachment("a1", at),
    ];

    expect(ids(sortTimelineNewestFirst(shuffled))).toEqual(["e13", "s12", "e11", "a1", "c1", "m1"]);
  });

  it("o instante vem antes do tipo, mesmo a 1 µs", () => {
    const older = status("s1", T("00:10.000001"), 50);
    const newer = message("m1", T("00:10.000002"));

    expect(compareTimelineItems(older, newer)).toBeLessThan(0);
    expect(ids(sortTimelineNewestFirst([older, newer]))).toEqual(["m1", "s1"]);
  });

  it("mesmo tipo no mesmo instante desempata pelo id (id desc, como a query)", () => {
    const at = T("00:10");
    expect(ids(sortTimelineNewestFirst([message("a", at), message("c", at), message("b", at)]))).toEqual(
      ["c", "b", "a"]
    );
  });

  it("não muta a lista recebida", () => {
    const items = [message("m1", T("00:01")), message("m2", T("00:02"))];
    sortTimelineNewestFirst(items);
    expect(ids(items)).toEqual(["m1", "m2"]);
  });
});

describe("buildTicketTimeline", () => {
  it("sem nada: página vazia, sem mais", () => {
    expect(buildTicketTimeline([source([]), source([])])).toEqual({
      items: [],
      hasMore: false,
      nextBefore: null,
    });
  });

  it("nenhuma fonte no limite e tudo cabe: sem mais, sem cursor", () => {
    const page = buildTicketTimeline(
      [source([message("m1", T("00:01"))]), source([comment("c1", T("00:02"))])],
      10
    );

    expect(page).toEqual({
      items: [comment("c1", T("00:02")), message("m1", T("00:01"))],
      hasMore: false,
      nextBefore: null,
    });
  });

  it("corta em no máximo pageSize, recuando até a fronteira de instante", () => {
    const sources = [
      source([message("m5", T("00:05")), message("m4", T("00:04")), message("m3", T("00:03"))]),
      source([comment("c4", T("00:04"))]),
    ];

    const three = buildTicketTimeline(sources, 3);
    expect(ids(three?.items ?? [])).toEqual(["m5", "c4", "m4"]);
    expect(three?.hasMore).toBe(true);
    expect(three?.nextBefore).toBe(T("00:04"));

    // O 2º e o 3º têm o mesmo instante: a página fica só com o 1º.
    const two = buildTicketTimeline(sources, 2);
    expect(ids(two?.items ?? [])).toEqual(["m5"]);
    expect(two?.nextBefore).toBe(T("00:05"));
  });

  it("o instante mais novo maior que a página vai inteiro", () => {
    const at = T("00:09");
    const page = buildTicketTimeline(
      [source([message("m1", at), message("m2", at), message("m3", at), message("m0", T("00:01"))])],
      2
    );

    expect(ids(page?.items ?? [])).toEqual(["m3", "m2", "m1"]);
    expect(page?.hasMore).toBe(true);
    expect(page?.nextBefore).toBe(at);
  });

  it("fonte no limite: a página para antes do piso, sem pular o que ela não trouxe", () => {
    // As mensagens bateram no limite (3): no instante da mais antiga (07) e
    // antes dele pode haver outras no banco. O comentário das 06 não pode entrar
    // na frente delas, e o das 07 não pode separar o instante.
    const page = buildTicketTimeline([
      source([message("m9", T("00:09")), message("m8", T("00:08")), message("m7", T("00:07"))], true),
      source([comment("c85", T("00:08.5")), comment("c7", T("00:07")), comment("c6", T("00:06"))]),
    ]);

    expect(ids(page?.items ?? [])).toEqual(["m9", "c85", "m8"]);
    expect(page?.hasMore).toBe(true);
    expect(page?.nextBefore).toBe(T("00:08"));
  });

  it("o piso é o mais novo entre as fontes que bateram no limite", () => {
    const page = buildTicketTimeline([
      source([message("m9", T("00:09")), message("m3", T("00:03"))], true),
      source([status("s8", T("00:08"), 2), status("s5", T("00:05"), 1)], true),
      source([comment("c6", T("00:06"))]),
    ]);

    // Piso = 05 (o dos status), não 03: o s5 e o m3 ficam para a próxima.
    expect(ids(page?.items ?? [])).toEqual(["m9", "s8", "c6"]);
    expect(page?.nextBefore).toBe(T("00:06"));
  });

  it("fonte no limite: há mais mesmo quando tudo o que sobrou cabe na página", () => {
    const page = buildTicketTimeline([
      source([message("m2", T("00:02")), message("m1", T("00:01"))], true),
    ]);

    expect(ids(page?.items ?? [])).toEqual(["m2"]);
    expect(page?.hasMore).toBe(true);
    expect(page?.nextBefore).toBe(T("00:02"));
  });

  it("devolve null quando uma fonte trouxe o limite inteiro no mesmo instante", () => {
    const at = T("00:09");
    expect(
      buildTicketTimeline([
        source([message("m1", at), message("m2", at)], true),
        source([comment("c1", T("00:05"))]),
      ])
    ).toBeNull();
  });

  it("nextBefore é o texto cru do item, sem normalizar", () => {
    const raw = "2026-09-25T23:45:57.1944-03:00";
    const page = buildTicketTimeline([source([message("m0", T("00:00")), message("m1", raw)])], 1);

    expect(ids(page?.items ?? [])).toEqual(["m1"]);
    expect(page?.nextBefore).toBe(raw);
  });
});
