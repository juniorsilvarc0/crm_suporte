import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import {
  NewTicketForm,
  type NewTicketFormHandle,
} from "@/features/tickets/components/new-ticket-form";
import type { ProductOption } from "@/features/products/types";
import { UUID_RE } from "@/lib/validation/uuid";

const CONVERSATION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
// Maiúscula de propósito: o schema a guarda em minúscula.
const KEY = "0F8FAD5B-D9CB-469F-A165-70867728950E";
const OTHER_KEY = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "3b241101-e2bb-4255-8caf-4136c566a962";

const PRODUCTS: ProductOption[] = [
  { id: PRODUCT_ID, name: "ERP Varejo", niche: null, color: "blue", archived_at: null },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CREATED = {
  ok: true,
  created: true,
  linked_messages: 3,
  ticket: { id: "t1", number: 1024, version: 1, status: "em_atendimento" },
};

/** A resposta fica presa até `release`: é o que deixa o 2º clique cair no envio em voo. */
function deferredFetch() {
  let release: (response: Response) => void = () => {};
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: (response: Response) => release(response) };
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

function renderForm(overrides: Partial<Parameters<typeof NewTicketForm>[0]> = {}) {
  const ref = createRef<NewTicketFormHandle>();
  const onCreated = vi.fn();
  const onExit = vi.fn();
  const onRetryProducts = vi.fn();
  render(
    <NewTicketForm
      ref={ref}
      conversationId={CONVERSATION_ID}
      products={PRODUCTS}
      productsLoading={false}
      onRetryProducts={onRetryProducts}
      onCreated={onCreated}
      onExit={onExit}
      {...overrides}
    />
  );
  return { ref, onCreated, onExit, onRetryProducts };
}

// O método mora no protótipo: a propriedade própria o esconde, e apagá-la o devolve.
const ownRandomUuid = Object.getOwnPropertyDescriptor(crypto, "randomUUID");

beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(KEY as `${string}-${string}-${string}-${string}-${string}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  if (ownRandomUuid) Object.defineProperty(crypto, "randomUUID", ownRandomUuid);
  else Reflect.deleteProperty(crypto, "randomUUID");
});

describe("NewTicketForm", () => {
  it("duplo clique em Abrir ticket envia UM POST, com a chave gerada ao abrir", async () => {
    const user = userEvent.setup();
    const { fetchMock, release } = deferredFetch();
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.dblClick(screen.getByRole("button", { name: "Abrir ticket" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => release(jsonResponse(CREATED, 201)));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = bodyOf(fetchMock);
    expect(request.url).toBe("/api/tickets");
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({
      conversation_id: CONVERSATION_ID,
      title: "Erro ao emitir nota",
      priority: "media",
      description: null,
      product_id: null,
      take_over: true,
      idempotency_key: KEY.toLowerCase(),
    });
    expect(toastMock.success).toHaveBeenCalledWith("Ticket SUP-1024 aberto.");
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("dois cliques antes de o botão desabilitar ainda enviam UM POST (a trava é a ref)", async () => {
    const user = userEvent.setup();
    const { fetchMock, release } = deferredFetch();
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    const submit = screen.getByRole("button", { name: "Abrir ticket" });
    // No mesmo tique: o React ainda não desenhou o `disabled` do 1º envio.
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => release(jsonResponse(CREATED, 201)));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reenvio depois de falha de rede repete a MESMA chave, a gerada ao abrir", async () => {
    // Depois da 1ª, o gerador devolve outra: uma chave gerada a cada envio daria duas.
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce(KEY as `${string}-${string}-${string}-${string}-${string}`)
      .mockReturnValue(OTHER_KEY as `${string}-${string}-${string}-${string}-${string}`);
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ ...CREATED, created: false }));
    vi.stubGlobal("fetch", fetchMock);
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confira a conexão");

    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 0).body.idempotency_key).toBe(KEY.toLowerCase());
    expect(bodyOf(fetchMock, 1).body.idempotency_key).toBe(KEY.toLowerCase());
  });

  it("replay (created: false) depois de editar o formulário avisa que valeu a 1ª tentativa, sem dizer \"aberto\"", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ ...CREATED, created: false }));
    vi.stubGlobal("fetch", fetchMock);
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confira a conexão");

    // O analista corrige antes de reenviar: o banco devolve o ticket da 1ª vez.
    await user.type(screen.getByLabelText("Título"), " fiscal");
    await user.click(screen.getByRole("radio", { name: "Crítica" }));
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    expect(bodyOf(fetchMock, 1).body).toMatchObject({ title: "Erro ao emitir nota fiscal", priority: "critica" });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ created: false }));
    expect(toastMock.warning).toHaveBeenCalledWith(
      "O ticket SUP-1024 já tinha sido aberto na tentativa anterior, com os dados daquela vez. Confira título, prioridade e fila."
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("sem crypto.randomUUID (http:// na rede local), monta e envia uma chave v4 válida", async () => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CREATED, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    const key = bodyOf(fetchMock).body.idempotency_key;
    expect(key).toMatch(UUID_RE);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Não é a do espião do `beforeEach`: saiu do `getRandomValues`.
    expect(key).not.toBe(KEY.toLowerCase());
    expect(toastMock.success).toHaveBeenCalledWith("Ticket SUP-1024 aberto.");
  });

  it("manda a prioridade, a fila, a descrição e o interruptor escolhidos", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CREATED, 201));
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    await user.type(screen.getByLabelText("Título"), "Sistema fora do ar");
    await user.click(screen.getByRole("radio", { name: "Crítica" }));
    await user.click(screen.getByRole("radio", { name: "ERP Varejo" }));
    await user.type(screen.getByLabelText("Descrição"), "Desde as 8h");
    const takeOver = screen.getByRole("switch", { name: /Assumir o atendimento/ });
    expect(takeOver).toBeChecked();
    await user.click(takeOver);
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock).body).toMatchObject({
      priority: "critica",
      product_id: PRODUCT_ID,
      description: "Desde as 8h",
      take_over: false,
    });
  });

  it("título curto não envia e mostra o erro no campo", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    await user.type(screen.getByLabelText("Título"), "ab");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));

    expect(await screen.findByText("Use ao menos 3 caracteres.")).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro de campo da rota vai para o campo; erro sem campo vira alerta no topo", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            code: "product_archived",
            message: "Fila arquivada.",
            errors: { product_id: ["Fila arquivada."] },
          },
          422
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            code: "idempotency_key_reused",
            message: "Esta abertura já foi usada em outra conversa. Abra o formulário de novo.",
          },
          409
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const { onCreated } = renderForm();

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    expect(await screen.findByText("Fila arquivada.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    expect(
      await screen.findByText("Esta abertura já foi usada em outra conversa. Abra o formulário de novo.")
    ).toHaveAttribute("role", "alert");
    expect(onCreated).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("sair limpo é livre; sujo pergunta \"Descartar?\" e cada pedido desfaz uma coisa", async () => {
    const user = userEvent.setup();
    const { ref, onExit } = renderForm();

    let canLeave: boolean | undefined;
    act(() => {
      canLeave = ref.current?.requestExit();
    });
    expect(canLeave).toBe(true);

    await user.type(screen.getByLabelText("Título"), "Rascunho");
    act(() => {
      canLeave = ref.current?.requestExit();
    });
    expect(canLeave).toBe(false);
    expect(screen.getByText("Descartar o novo ticket?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar editando" })).toHaveFocus();

    // Com a pergunta aberta, o próximo pedido só fecha a pergunta.
    act(() => {
      canLeave = ref.current?.requestExit();
    });
    expect(canLeave).toBe(false);
    expect(screen.queryByText("Descartar o novo ticket?")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("Rascunho");

    // "Cancelar" com o formulário sujo também pergunta; "Descartar" sai.
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("\"Cancelar\" com o formulário limpo sai direto", async () => {
    const user = userEvent.setup();
    const { onExit } = renderForm();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Descartar o novo ticket?")).not.toBeInTheDocument();
  });

  it("enviando, não deixa sair", async () => {
    const user = userEvent.setup();
    const { release } = deferredFetch();
    const { ref } = renderForm();

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Abrir ticket" })).toBeDisabled());

    let canLeave: boolean | undefined;
    act(() => {
      canLeave = ref.current?.requestExit();
    });
    expect(canLeave).toBe(false);
    expect(screen.queryByText("Descartar o novo ticket?")).not.toBeInTheDocument();

    await act(async () => release(jsonResponse(CREATED, 201)));
  });

  it("sem as filas, avisa com \"Tentar de novo\" e ainda abre o ticket sem fila", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CREATED, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { onRetryProducts } = renderForm({ products: null });

    expect(screen.getByText("Não foi possível carregar as filas.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sem fila" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetryProducts).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Título"), "Erro ao emitir nota");
    await user.click(screen.getByRole("button", { name: "Abrir ticket" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock).body.product_id).toBeNull();
  });
});
