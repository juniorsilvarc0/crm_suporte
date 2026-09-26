import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastSuccess } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { TicketTimeline } from "@/features/tickets/components/ticket-timeline";
import type {
  TicketComment,
  TicketTimelinePage,
  TimelineCommentItem,
  TimelineItem,
  TimelineMessageItem,
  TimelineStatusItem,
} from "@/features/tickets/types";

const TICKET = "0b0e8f4c-3d1a-4a55-9d5e-1c2b3a4d5e6f";
const CONVERSATION = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const ANA = "11111111-1111-4111-8111-111111111111";
const BRUNO = "22222222-2222-4222-8222-222222222222";
const USERS = [
  { id: ANA, name: "Ana" },
  { id: BRUNO, name: "Bruno" },
];

function status(overrides: Partial<TimelineStatusItem> = {}): TimelineStatusItem {
  return {
    kind: "status",
    id: "st-1",
    at: "2026-09-26T12:00:00+00:00",
    seq: 1,
    from_status: null,
    to_status: "novo",
    actor_type: "ai",
    actor_user_id: null,
    reason: null,
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
    body: "Cliente pediu retorno amanhã",
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
    content: "O sistema não emite nota",
    file_name: null,
    delivery_status: "delivered",
    sent_by_user_id: null,
    is_deleted: false,
    ...overrides,
  };
}

function page(items: TimelineItem[], more: Partial<TicketTimelinePage> = {}): TicketTimelinePage {
  return { items, hasMore: false, nextBefore: null, ...more };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(...responses: Array<() => Response>) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return next!();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderTimeline(initial: TicketTimelinePage | null, viewerId = ANA) {
  const props = { ticketId: TICKET, conversationId: CONVERSATION, viewerId, users: USERS };
  const view = render(<TicketTimeline {...props} initial={initial} />);
  return {
    ...view,
    user: userEvent.setup(),
    rerenderWith: (next: TicketTimelinePage | null) =>
      view.rerender(<TicketTimeline {...props} initial={next} />),
  };
}

const entries = () =>
  within(screen.getByRole("list", { name: "Linha do tempo do ticket" })).getAllByRole("listitem");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TicketTimeline", () => {
  it("mostra do mais antigo para o mais novo, com remetente e link para a conversa", () => {
    // A API manda do mais novo para o mais antigo.
    renderTimeline(page([comment(), message(), status()]));

    const [first, second, third] = entries();
    expect(first).toHaveTextContent("Status inicial: Novo");
    expect(first).toHaveTextContent("IA");
    expect(second).toHaveTextContent("Cliente");
    expect(second).toHaveTextContent("O sistema não emite nota");
    expect(within(second).getByRole("link", { name: "ver na conversa" })).toHaveAttribute(
      "href",
      `/app/chat?conversation=${CONVERSATION}`
    );
    expect(third).toHaveTextContent("Nota do ticket");
    expect(third).toHaveTextContent("Você");
  });

  it("assina a nota de outro pelo nome, a da integração e a de usuário removido", () => {
    renderTimeline(
      page([
        comment({ id: "c1", author_user_id: BRUNO }),
        comment({ id: "c2", author_user_id: null, author_token_id: "tok" }),
        comment({ id: "c3", author_user_id: null }),
        message({ id: "m2", type: "note", sender_type: "agent", sent_by_user_id: BRUNO, content: "Ver log" }),
      ])
    );
    const text = entries().map((item) => item.textContent);
    expect(text.some((t) => t?.includes("Nota no chat") && t.includes("Bruno"))).toBe(true);
    expect(text.some((t) => t?.includes("Integração"))).toBe(true);
    expect(text.some((t) => t?.includes("Usuário removido"))).toBe(true);
    // Só o autor tem o menu: nenhuma dessas é da Ana.
    expect(screen.queryByRole("button", { name: "Ações da nota" })).toBeNull();
  });

  it("falha sem itens: frase e Tentar de novo, que recarrega a página", async () => {
    stubFetch(() => jsonResponse({}));
    const { user } = renderTimeline(null);

    expect(screen.getByText("Não foi possível carregar a linha do tempo.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalled();
    // O composer continua: escrever não depende de ler.
    expect(screen.getByRole("textbox", { name: "Nota do ticket" })).toBeInTheDocument();
  });

  it("vazio é um estado próprio", () => {
    renderTimeline(page([]));
    expect(screen.getByText("Nenhuma atividade registrada ainda.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carregar anteriores" })).toBeNull();
  });

  it("Carregar anteriores manda o cursor com o + codificado e junta sem duplicar", async () => {
    const cursor = "2026-09-26T09:01:00.123456+03:00";
    const fetchMock = stubFetch(() =>
      jsonResponse({
        ok: true,
        items: [message(), message({ id: "old", at: "2026-09-25T10:00:00+00:00", content: "Bom dia" })],
        hasMore: false,
        nextBefore: null,
      })
    );
    const { user } = renderTimeline(page([comment(), message()], { hasMore: true, nextBefore: cursor }));

    await user.click(screen.getByRole("button", { name: "Carregar anteriores" }));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/tickets/${TICKET}/timeline?before=2026-09-26T09%3A01%3A00.123456%2B03%3A00`
    );
    await waitFor(() => expect(entries()).toHaveLength(3));
    expect(entries()[0]).toHaveTextContent("Bom dia");
    expect(screen.queryByRole("button", { name: "Carregar anteriores" })).toBeNull();
  });

  it("falha ao carregar anteriores: aviso e Tentar de novo no mesmo lugar", async () => {
    stubFetch(() => jsonResponse({ ok: false, message: "Não foi possível carregar a timeline." }, 500));
    const { user } = renderTimeline(
      page([comment()], { hasMore: true, nextBefore: "2026-09-26T12:05:00+00:00" })
    );

    await user.click(screen.getByRole("button", { name: "Carregar anteriores" }));

    expect(
      await screen.findByText("Não foi possível carregar as atividades anteriores.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(entries()).toHaveLength(1);
  });

  it("a página nova do refresh entra sem perder as anteriores já carregadas", async () => {
    stubFetch(() =>
      jsonResponse({
        ok: true,
        items: [message({ id: "old", at: "2026-09-25T10:00:00+00:00", content: "Bom dia" })],
        hasMore: false,
        nextBefore: null,
      })
    );
    const { user, rerenderWith } = renderTimeline(
      page([message()], { hasMore: true, nextBefore: "2026-09-26T12:01:00+00:00" })
    );
    await user.click(screen.getByRole("button", { name: "Carregar anteriores" }));
    await waitFor(() => expect(entries()).toHaveLength(2));

    rerenderWith(page([comment(), message()], { hasMore: true, nextBefore: "2026-09-26T12:01:00+00:00" }));

    expect(entries()).toHaveLength(3);
    expect(entries()[0]).toHaveTextContent("Bom dia");
    // O cursor continua o da página mais antiga já lida (que não tem mais nada).
    expect(screen.queryByRole("button", { name: "Carregar anteriores" })).toBeNull();
  });

  it("refresh que não encosta na tela: Carregar anteriores desce pelo trecho do meio", async () => {
    const older = message({ id: "old", at: "2026-09-25T10:00:00+00:00", content: "Bom dia" });
    const middle = message({ id: "mid", at: "2026-09-26T13:00:00+00:00", content: "Já reiniciei" });
    const fetchMock = stubFetch(
      () => jsonResponse({ ok: true, items: [older], hasMore: false, nextBefore: null }),
      () => jsonResponse({ ok: true, items: [middle, message(), older], hasMore: false, nextBefore: null })
    );
    const { user, rerenderWith } = renderTimeline(
      page([message()], { hasMore: true, nextBefore: "2026-09-26T12:01:00+00:00" })
    );
    await user.click(screen.getByRole("button", { name: "Carregar anteriores" }));
    await waitFor(() => expect(entries()).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Carregar anteriores" })).toBeNull();

    // Entrou mais que uma página enquanto a aba dormia: a 1ª página nova
    // começa às 14h01, e a tela parou às 12h01. O "Já reiniciei" ficou no meio.
    const later = "2026-09-26T14:01:00+00:00";
    rerenderWith(
      page([message({ id: "new", at: later, content: "Voltou a funcionar" })], {
        hasMore: true,
        nextBefore: later,
      })
    );
    expect(entries()).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Carregar anteriores" }));

    expect(fetchMock.mock.calls[1][0]).toBe(
      `/api/tickets/${TICKET}/timeline?before=2026-09-26T14%3A01%3A00%2B00%3A00`
    );
    await waitFor(() => expect(entries()).toHaveLength(4));
    expect(entries()[2]).toHaveTextContent("Já reiniciei");
    expect(screen.queryByRole("button", { name: "Carregar anteriores" })).toBeNull();
  });

  it("a nota recém-adicionada não esconde o trecho que o refresh seguinte não alcançou", async () => {
    const created: TicketComment = {
      id: "co-new",
      author_user_id: ANA,
      author_token_id: null,
      body: "Liguei para o cliente",
      created_at: "2026-09-26T14:30:00+00:00",
      edited_at: null,
      deleted_at: null,
    };
    stubFetch(
      () =>
        jsonResponse({
          ok: true,
          items: [message({ id: "old", at: "2026-09-25T10:00:00+00:00", content: "Bom dia" })],
          hasMore: false,
          nextBefore: null,
        }),
      () => jsonResponse({ ok: true, comment: created }, 201)
    );
    const { user, rerenderWith } = renderTimeline(
      page([message()], { hasMore: true, nextBefore: "2026-09-26T12:01:00+00:00" })
    );
    await user.click(screen.getByRole("button", { name: "Carregar anteriores" }));
    await waitFor(() => expect(entries()).toHaveLength(2));

    // A nota entra na hora e é a mais nova da tela; o refresh que ela dispara
    // traz uma 1ª página que começa às 14h01, longe das 12h01.
    await user.type(screen.getByRole("textbox", { name: "Nota do ticket" }), "Liguei para o cliente");
    await user.click(screen.getByRole("button", { name: "Adicionar nota" }));
    await waitFor(() => expect(entries()).toHaveLength(3));
    expect(refreshMock).toHaveBeenCalled();

    const later = "2026-09-26T14:01:00+00:00";
    rerenderWith(
      page(
        [
          comment({ id: "co-new", at: created.created_at, body: created.body }),
          message({ id: "new", at: later, content: "Voltou a funcionar" }),
        ],
        { hasMore: true, nextBefore: later }
      )
    );

    expect(entries()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Carregar anteriores" })).toBeInTheDocument();
  });

  it("Ctrl+Enter adiciona a nota, que aparece na hora, e recarrega a página", async () => {
    const created: TicketComment = {
      id: "co-new",
      author_user_id: ANA,
      author_token_id: null,
      body: "Liguei para o cliente",
      created_at: "2026-09-26T13:00:00.000001+00:00",
      edited_at: null,
      deleted_at: null,
    };
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, comment: created }, 201));
    const { user } = renderTimeline(page([status()]));

    const box = screen.getByRole("textbox", { name: "Nota do ticket" });
    await user.type(box, "  Liguei para o cliente  ");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(entries()).toHaveLength(2));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/tickets/${TICKET}/comments`);
    expect(init?.method).toBe("POST");
    // O schema da rota apara o texto antes de enviar.
    expect(JSON.parse(String(init?.body))).toEqual({ body: "Liguei para o cliente" });
    expect(entries()[1]).toHaveTextContent("Liguei para o cliente");
    expect(box).toHaveValue("");
    expect(refreshMock).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Nota adicionada.");
  });

  it("não envia nota em branco e mostra o erro de campo da rota", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse(
        { ok: false, message: "Revise os campos destacados.", errors: { body: ["Remova os caracteres inválidos."] } },
        400
      )
    );
    const { user } = renderTimeline(page([status()]));

    await user.click(screen.getByRole("button", { name: "Adicionar nota" }));
    expect(await screen.findByText("Escreva o comentário.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "Nota do ticket" }), "texto");
    await user.click(screen.getByRole("button", { name: "Adicionar nota" }));
    expect(await screen.findByText("Remova os caracteres inválidos.")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("o autor edita a nota no lugar", async () => {
    const edited: TicketComment = {
      id: "co-1",
      author_user_id: ANA,
      author_token_id: null,
      body: "Retorno marcado para amanhã 9h",
      created_at: "2026-09-26T12:05:00+00:00",
      edited_at: "2026-09-26T12:30:00+00:00",
      deleted_at: null,
    };
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, comment: edited }));
    const { user } = renderTimeline(page([comment()]));

    await user.click(screen.getByRole("button", { name: "Ações da nota" }));
    await user.click(await screen.findByRole("menuitem", { name: "Editar" }));
    const box = screen.getByRole("textbox", { name: "Editar nota" });
    await user.clear(box);
    await user.type(box, "Retorno marcado para amanhã 9h");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(entries()[0]).toHaveTextContent("Retorno marcado para amanhã 9h"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/tickets/${TICKET}/comments/co-1`);
    expect(init?.method).toBe("PATCH");
    expect(entries()[0]).toHaveTextContent("editada");
    expect(screen.queryByRole("textbox", { name: "Editar nota" })).toBeNull();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("apagar pede confirmação na própria nota e deixa o registro de apagada", async () => {
    const deleted: TicketComment = {
      id: "co-1",
      author_user_id: ANA,
      author_token_id: null,
      body: null,
      created_at: "2026-09-26T12:05:00+00:00",
      edited_at: null,
      deleted_at: "2026-09-26T12:40:00+00:00",
    };
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, comment: deleted }));
    const { user } = renderTimeline(page([comment()]));

    await user.click(screen.getByRole("button", { name: "Ações da nota" }));
    await user.click(await screen.findByRole("menuitem", { name: "Apagar" }));
    expect(screen.getByText("Apagar esta nota? Ela some para toda a equipe.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Apagar nota" }));

    await waitFor(() => expect(entries()[0]).toHaveTextContent("Nota apagada"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/tickets/${TICKET}/comments/co-1`);
    expect(init?.method).toBe("DELETE");
    expect(screen.queryByRole("button", { name: "Ações da nota" })).toBeNull();
  });

  it("nota apagada em outra aba: mostra o motivo e recarrega", async () => {
    stubFetch(() =>
      jsonResponse({ ok: false, code: "comment_deleted", message: "Comentário apagado não pode ser alterado." }, 409)
    );
    const { user } = renderTimeline(page([comment()]));

    await user.click(screen.getByRole("button", { name: "Ações da nota" }));
    await user.click(await screen.findByRole("menuitem", { name: "Apagar" }));
    await user.click(screen.getByRole("button", { name: "Apagar nota" }));

    expect(await screen.findByText("Comentário apagado não pode ser alterado.")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });
});
