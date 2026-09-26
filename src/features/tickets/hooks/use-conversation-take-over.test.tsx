import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import { ChatHeader } from "@/features/chat/components/chat-header";
import type { ChatConversation } from "@/features/chat/types";
import {
  TakeOverDialog,
  takeOverConflictTitle,
} from "@/features/tickets/components/take-over-dialog";
import { useConversationTakeOver } from "@/features/tickets/hooks/use-conversation-take-over";

const CONVERSATION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TICKET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_USER = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const CONVERSATION: ChatConversation = {
  id: CONVERSATION_ID,
  integration_id: null,
  contact_id: "contact-1",
  external_id: "5511999990000@s.whatsapp.net",
  contact_name: "Maria Souza",
  contact_phone: "5511999990000",
  contact_avatar_url: null,
  archived_at: null,
  removed_at: null,
  pinned_at: null,
  status: "bot",
  active_ticket_id: TICKET_ID,
  unread_count: 0,
  last_message_at: null,
  last_message_preview: null,
  metadata: {},
  created_at: "2026-09-20T12:00:00+00:00",
  updated_at: "2026-09-26T12:00:00+00:00",
};

const originalMatchMedia = window.matchMedia;

// O Dialog pergunta a largura: no teste, desktop.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const takeOverOk = () =>
  jsonResponse({
    ok: true,
    ticket: { id: TICKET_ID, number: 1024 },
    conversation: { id: CONVERSATION_ID, status: "human" },
  });

const alreadyAssigned = () =>
  jsonResponse(
    {
      ok: false,
      code: "already_assigned",
      message: "O ticket já está com outro analista.",
      assigned_to_user_id: OTHER_USER,
      assigned_to_name: "Ana",
    },
    409
  );

function stubFetch(...responses: Array<() => Response>) {
  const fetchMock = vi.fn();
  for (const respond of responses) fetchMock.mockImplementationOnce(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as unknown };
}

/** O cabeçalho, o hook e o diálogo ligados como no `ChatView`. */
function Harness({
  conversation,
  onTakeover,
  onConversationUpdate,
  refresh,
}: {
  conversation: ChatConversation;
  onTakeover: () => Promise<void>;
  onConversationUpdate: (updated: Partial<ChatConversation> & { id: string }) => void;
  refresh: () => void;
}) {
  const takeOver = useConversationTakeOver({
    status: conversation.status,
    activeTicketId: conversation.active_ticket_id,
    activeTicket: conversation.active_ticket_id ? { id: TICKET_ID, number: 1024 } : null,
    onTakeover,
    onConversationUpdate,
    refresh,
  });
  return (
    <>
      <ChatHeader
        conversation={conversation}
        onTakeover={conversation.status === "human" ? onTakeover : takeOver.takeOver}
        takeoverLoading={takeOver.pending !== null}
      />
      {takeOver.conflict && (
        <TakeOverDialog
          conflict={takeOver.conflict}
          pending={takeOver.pending}
          onReassign={() => void takeOver.reassign()}
          onConversationOnly={() => void takeOver.conversationOnly()}
          onDismiss={takeOver.dismiss}
        />
      )}
    </>
  );
}

function renderHarness(conversation: ChatConversation = CONVERSATION) {
  const onTakeover = vi.fn(async () => {});
  const onConversationUpdate = vi.fn();
  const refresh = vi.fn();
  const props = { onTakeover, onConversationUpdate, refresh };
  const utils = render(<Harness conversation={conversation} {...props} />);
  const rerender = (next: ChatConversation) => utils.rerender(<Harness conversation={next} {...props} />);
  return { onTakeover, onConversationUpdate, refresh, rerender };
}

const DIALOG_TITLE = "SUP-1024 está com Ana.";

describe("Assumir no cabeçalho do chat", () => {
  it("com ticket em foco, faz o take-over do ticket (e não o PATCH da conversa)", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(takeOverOk);
    const { onTakeover, onConversationUpdate, refresh } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/tickets/${TICKET_ID}/take-over`,
      method: "POST",
      body: {},
    });
    expect(onTakeover).not.toHaveBeenCalled();
    // A conversa que a rota gravou vai direto para a tela, sem esperar o Realtime.
    expect(onConversationUpdate).toHaveBeenCalledTimes(1);
    expect(onConversationUpdate).toHaveBeenCalledWith({ id: CONVERSATION_ID, status: "human" });
    expect(toastMock.success).toHaveBeenCalledWith("Você assumiu SUP-1024.");
  });

  it("duplo clique com a resposta em voo sai uma vez só", async () => {
    const user = userEvent.setup();
    // A resposta só chega depois dos dois cliques.
    let respond: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        respond = resolve;
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { refresh } = renderHarness();

    await user.dblClick(screen.getByRole("button", { name: "Assumir" }));
    respond(takeOverOk());

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("duas chamadas antes de o botão desabilitar ainda saem UMA vez (a trava é a ref)", async () => {
    let respond: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        respond = resolve;
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useConversationTakeOver({
        status: "bot",
        activeTicketId: TICKET_ID,
        activeTicket: null,
        onTakeover: vi.fn(),
        onConversationUpdate: vi.fn(),
        refresh: vi.fn(),
      })
    );

    // No mesmo tique: o `pending` do 1º ainda não chegou ao render.
    act(() => {
      void result.current.takeOver();
      void result.current.takeOver();
    });
    await act(async () => respond(takeOverOk()));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sem ticket em foco, usa o PATCH da conversa de hoje", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    const { onTakeover, onConversationUpdate } = renderHarness({ ...CONVERSATION, active_ticket_id: null });

    await user.click(screen.getByRole("button", { name: "Assumir" }));

    await waitFor(() => expect(onTakeover).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onConversationUpdate).not.toHaveBeenCalled();
  });

  it("already_assigned abre o diálogo e relê os tickets; \"Assumir conversa e ticket\" refaz com reassign", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(alreadyAssigned, takeOverOk);
    const { onTakeover, onConversationUpdate, refresh } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));

    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toastMock.error).not.toHaveBeenCalled();
    // O 409 não gravou nada: a conversa na tela fica como está.
    expect(onConversationUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Assumir conversa e ticket" }));

    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(requestOf(fetchMock, 1)).toEqual({
      url: `/api/tickets/${TICKET_ID}/take-over`,
      method: "POST",
      body: { reassign: true },
    });
    expect(onTakeover).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onConversationUpdate).toHaveBeenCalledTimes(1);
    expect(onConversationUpdate).toHaveBeenCalledWith({ id: CONVERSATION_ID, status: "human" });
    expect(toastMock.success).toHaveBeenCalledWith("Você assumiu SUP-1024.");
  });

  it("\"Só a conversa\" usa o PATCH de hoje e deixa o ticket com quem está", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(alreadyAssigned);
    const { onTakeover, onConversationUpdate } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));
    await user.click(await screen.findByRole("button", { name: "Só a conversa" }));

    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(onTakeover).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // O PATCH de hoje já aplica a conversa que gravou (o `onTakeover`).
    expect(onConversationUpdate).not.toHaveBeenCalled();
  });

  it("\"Só a conversa\" não devolve à IA a conversa que já virou humana enquanto o diálogo perguntava", async () => {
    const user = userEvent.setup();
    stubFetch(alreadyAssigned);
    const { onTakeover, rerender } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));
    await screen.findByText(DIALOG_TITLE);
    // O Realtime trouxe a conversa humana (outro analista assumiu).
    rerender({ ...CONVERSATION, status: "human" });

    await user.click(screen.getByRole("button", { name: "Só a conversa" }));

    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(onTakeover).not.toHaveBeenCalled();
  });

  it("\"Assumir conversa e ticket\" sem rede avisa e deixa o diálogo para tentar de novo", async () => {
    const user = userEvent.setup();
    stubFetch(alreadyAssigned, () => {
      throw new TypeError("Failed to fetch");
    });
    const { refresh } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));
    await user.click(await screen.findByRole("button", { name: "Assumir conversa e ticket" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Não foi possível assumir o atendimento. Confira a conexão e tente de novo."
      )
    );
    expect(screen.getByText(DIALOG_TITLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assumir conversa e ticket" })).toBeEnabled();
    // Só a releitura do 409: sem resposta, não há o que reler.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("\"Assumir conversa e ticket\" recusado em definitivo fecha o diálogo, avisa e relê", async () => {
    const user = userEvent.setup();
    stubFetch(alreadyAssigned, () =>
      jsonResponse({ ok: false, code: "ticket_terminal", message: "O ticket já foi encerrado." }, 409)
    );
    const { refresh } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));
    await user.click(await screen.findByRole("button", { name: "Assumir conversa e ticket" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("O ticket já foi encerrado."));
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("Esc com o \"Assumir conversa e ticket\" em voo não fecha o diálogo", async () => {
    const user = userEvent.setup();
    let respond: (response: Response) => void = () => {};
    // A 2ª resposta (a do reassign) fica presa até `respond`.
    stubFetch(alreadyAssigned).mockImplementationOnce(
      () => new Promise<Response>((resolve) => {
        respond = resolve;
      })
    );
    renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));
    await user.click(await screen.findByRole("button", { name: "Assumir conversa e ticket" }));
    await user.keyboard("{Escape}");

    expect(screen.getByText(DIALOG_TITLE)).toBeInTheDocument();

    await act(async () => respond(takeOverOk()));
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
  });

  it("o ticket em foco sumiu (404): avisa e relê, sem diálogo", async () => {
    const user = userEvent.setup();
    stubFetch(() => jsonResponse({ ok: false, code: "not_found", message: "Ticket não encontrado." }, 404));
    const { onTakeover, refresh } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Ticket não encontrado."));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onTakeover).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("outra recusa vira toast com a mensagem da rota e relê, sem diálogo", async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      jsonResponse({ ok: false, code: "ticket_terminal", message: "O ticket já foi encerrado." }, 409)
    );
    const { onTakeover, onConversationUpdate, refresh } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("O ticket já foi encerrado."));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onTakeover).not.toHaveBeenCalled();
    expect(onConversationUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sem rede, avisa a conexão e não mexe na conversa nem relê", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { onConversationUpdate, refresh } = renderHarness();

    await user.click(screen.getByRole("button", { name: "Assumir" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Não foi possível assumir o atendimento. Confira a conexão e tente de novo."
      )
    );
    expect(onConversationUpdate).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("takeOverConflictTitle", () => {
  it("não inventa nome nem protocolo que a tela não tem", () => {
    expect(takeOverConflictTitle({ ticketId: TICKET_ID, protocol: "SUP-1024", assigneeName: "Ana" })).toBe(
      "SUP-1024 está com Ana."
    );
    expect(takeOverConflictTitle({ ticketId: TICKET_ID, protocol: "SUP-1024", assigneeName: null })).toBe(
      "SUP-1024 já está com outro analista."
    );
    expect(takeOverConflictTitle({ ticketId: TICKET_ID, protocol: null, assigneeName: "Ana" })).toBe(
      "O ticket em foco está com Ana."
    );
  });
});
