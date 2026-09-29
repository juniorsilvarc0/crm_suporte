import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ProductsManager } from "@/features/products/components/products-manager";
import type { ProductOption } from "@/features/products/types";

const ERP_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const WEB_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OLD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const ERP: ProductOption = {
  id: ERP_ID,
  name: "ERP Varejo",
  niche: "Varejo",
  color: "blue",
  archived_at: null,
};
const WEB: ProductOption = {
  id: WEB_ID,
  name: "Suporte Web",
  niche: null,
  color: "teal",
  archived_at: null,
};
const OLD: ProductOption = {
  id: OLD_ID,
  name: "PDV Antigo",
  niche: null,
  color: "slate",
  archived_at: "2026-09-20T12:00:00+00:00",
};

const ARCHIVE_QUESTION = "Arquivar a fila? Ela some do Novo ticket e continua nos tickets antigos.";
const RESTORE_QUESTION = "Reativar a fila? Ela volta a aparecer no Novo ticket.";

const originalMatchMedia = window.matchMedia;

// O Dialog decide entre caixa e gaveta pela largura: no teste, desktop.
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

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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

function requestOf(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return {
    url,
    method: init.method,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

function rowOf(name: string) {
  const row = screen.getByText(name).closest("li");
  if (!row) throw new Error(`linha de ${name} não encontrada`);
  return row;
}

describe("ProductsManager", () => {
  describe("estados", () => {
    it("lista as filas, marca a arquivada e mostra o nicho", () => {
      render(<ProductsManager products={[ERP, WEB, OLD]} />);

      const items = screen.getAllByRole("listitem");
      expect(items.map((item) => within(item).getByTitle(/./).textContent)).toEqual([
        "ERP Varejo",
        "Suporte Web",
        "PDV Antigo",
      ]);
      expect(within(rowOf("ERP Varejo")).getByText("Varejo")).toBeInTheDocument();
      expect(within(rowOf("Suporte Web")).getByText("Sem nicho")).toBeInTheDocument();
      expect(within(rowOf("PDV Antigo")).getByText("Arquivada")).toBeInTheDocument();
      expect(within(rowOf("ERP Varejo")).queryByText("Arquivada")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reativar a fila PDV Antigo" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Arquivar a fila ERP Varejo" })).toBeInTheDocument();
    });

    it("falha na leitura diz que falhou e oferece Tentar de novo, sem parecer vazio", async () => {
      const user = userEvent.setup();
      render(<ProductsManager products={null} />);

      expect(screen.getByText("Não foi possível carregar as filas.")).toBeInTheDocument();
      expect(screen.queryByText("Nenhuma fila ainda.")).not.toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    it("sem filas mostra o vazio e o caminho para criar", () => {
      render(<ProductsManager products={[]} />);

      expect(screen.getByText("Nenhuma fila ainda.")).toBeInTheDocument();
      expect(screen.queryByText("Não foi possível carregar as filas.")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Nova fila" })).toBeInTheDocument();
    });
  });

  describe("criar", () => {
    it("envia nome, nicho e cor para POST /api/products e recarrega a lista", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(
        jsonResponse({
          ok: true,
          message: "Produto criado.",
          item: { ...ERP, id: WEB_ID, name: "Nota Fiscal", niche: "Fiscal", color: "rose" },
        })
      );
      render(<ProductsManager products={[]} />);

      await user.click(screen.getByRole("button", { name: "Nova fila" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox", { name: "Nome" }), "  Nota Fiscal ");
      await user.type(within(dialog).getByRole("textbox", { name: "Nicho" }), "Fiscal");
      await user.click(within(dialog).getByRole("radio", { name: "rose" }));
      await user.click(within(dialog).getByRole("button", { name: "Criar fila" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestOf(fetchMock)).toEqual({
        url: "/api/products",
        method: "POST",
        body: { name: "Nota Fiscal", niche: "Fiscal", color: "rose" },
      });
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(toastMock.success).toHaveBeenCalledWith("Fila criada.");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("nicho em branco vai como null e a cor padrão é slate", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(jsonResponse({ ok: true, item: WEB }));
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Nova fila" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox", { name: "Nome" }), "Suporte Web");
      await user.click(within(dialog).getByRole("button", { name: "Criar fila" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestOf(fetchMock).body).toEqual({ name: "Suporte Web", niche: null, color: "slate" });
    });

    it("nome curto não chega à rota: o erro do schema aparece no campo", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch();
      render(<ProductsManager products={[]} />);

      await user.click(screen.getByRole("button", { name: "Nova fila" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox", { name: "Nome" }), "A");
      await user.click(within(dialog).getByRole("button", { name: "Criar fila" }));

      expect(await within(dialog).findByText("Use ao menos 2 caracteres.")).toBeInTheDocument();
      expect(within(dialog).getByRole("textbox", { name: "Nome" })).toHaveAttribute(
        "aria-invalid",
        "true"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("409 de nome repetido marca o campo citando a fila que já existe", async () => {
      const user = userEvent.setup();
      stubFetch(
        jsonResponse(
          {
            ok: false,
            message: "Já existe um produto com este nome.",
            errors: { name: ["Já existe um produto com este nome."] },
            item: ERP,
          },
          409
        )
      );
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Nova fila" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox", { name: "Nome" }), "erp varejo");
      await user.click(within(dialog).getByRole("button", { name: "Criar fila" }));

      expect(await within(dialog).findByText("Já existe a fila «ERP Varejo».")).toBeInTheDocument();
      expect(within(dialog).getByRole("textbox", { name: "Nome" })).toHaveAttribute(
        "aria-invalid",
        "true"
      );
      expect(refreshMock).not.toHaveBeenCalled();
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("dois cliques em Criar fila antes de o botão desabilitar fazem um envio só", async () => {
      const user = userEvent.setup();
      const { fetchMock, release } = deferredFetch();
      render(<ProductsManager products={[]} />);

      await user.click(screen.getByRole("button", { name: "Nova fila" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox", { name: "Nome" }), "Nota Fiscal");
      const submit = within(dialog).getByRole("button", { name: "Criar fila" });
      // No mesmo tique: o React ainda não desenhou o `disabled` do 1º envio.
      act(() => {
        fireEvent.click(submit);
        fireEvent.click(submit);
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await act(async () => release(jsonResponse({ ok: true, item: WEB })));
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("editar", () => {
    it("renomear com 409 mostra o erro no campo e não fecha nem recarrega", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(
        jsonResponse(
          {
            ok: false,
            code: "duplicate",
            message: "Já existe uma fila com este nome.",
            errors: { name: ["Já existe uma fila com este nome."] },
            item: ERP,
          },
          409
        )
      );
      render(<ProductsManager products={[ERP, WEB]} />);

      await user.click(screen.getByRole("button", { name: "Editar a fila Suporte Web" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Editar fila")).toBeInTheDocument();
      const name = within(dialog).getByRole("textbox", { name: "Nome" });
      expect(name).toHaveValue("Suporte Web");
      await user.clear(name);
      await user.type(name, "erp varejo");
      await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // Só o que mudou: nicho e cor ficam de fora do PATCH.
      expect(requestOf(fetchMock)).toEqual({
        url: `/api/products/${WEB_ID}`,
        method: "PATCH",
        body: { name: "erp varejo" },
      });
      expect(await within(dialog).findByText("Já existe a fila «ERP Varejo».")).toBeInTheDocument();
      expect(name).toHaveAttribute("aria-invalid", "true");
      expect(name).toHaveFocus();
      expect(refreshMock).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("409 sem o item (a releitura falhou) mostra a mensagem da rota no campo", async () => {
      const user = userEvent.setup();
      stubFetch(
        jsonResponse(
          {
            ok: false,
            code: "duplicate",
            message: "Já existe uma fila com este nome.",
            errors: { name: ["Já existe uma fila com este nome."] },
          },
          409
        )
      );
      render(<ProductsManager products={[ERP, WEB]} />);

      await user.click(screen.getByRole("button", { name: "Editar a fila Suporte Web" }));
      const dialog = await screen.findByRole("dialog");
      const name = within(dialog).getByRole("textbox", { name: "Nome" });
      await user.clear(name);
      await user.type(name, "ERP Varejo");
      await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

      expect(await within(dialog).findByText("Já existe uma fila com este nome.")).toBeInTheDocument();
    });

    it("trocar só a cor manda só a cor e recarrega", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(jsonResponse({ ok: true, item: { ...ERP, color: "rose" } }));
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Editar a fila ERP Varejo" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("radio", { name: "blue" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
      await user.click(within(dialog).getByRole("radio", { name: "rose" }));
      await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestOf(fetchMock)).toEqual({
        url: `/api/products/${ERP_ID}`,
        method: "PATCH",
        body: { color: "rose" },
      });
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(toastMock.success).toHaveBeenCalledWith("Fila atualizada.");
    });

    it("apagar o nicho manda niche null", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(jsonResponse({ ok: true, item: { ...ERP, niche: null } }));
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Editar a fila ERP Varejo" }));
      const dialog = await screen.findByRole("dialog");
      await user.clear(within(dialog).getByRole("textbox", { name: "Nicho" }));
      await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestOf(fetchMock).body).toEqual({ niche: null });
    });

    it("salvar sem mudar nada fecha sem requisição", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch();
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Editar a fila ERP Varejo" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("422 no nicho vai para o campo do nicho", async () => {
      const user = userEvent.setup();
      stubFetch(
        jsonResponse(
          {
            ok: false,
            code: "invalid",
            message: "Use até 80 caracteres no nicho, ou deixe em branco.",
            errors: { niche: ["Use até 80 caracteres no nicho, ou deixe em branco."] },
          },
          422
        )
      );
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Editar a fila ERP Varejo" }));
      const dialog = await screen.findByRole("dialog");
      const niche = within(dialog).getByRole("textbox", { name: "Nicho" });
      await user.type(niche, " e atacado");
      await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

      expect(
        await within(dialog).findByText("Use até 80 caracteres no nicho, ou deixe em branco.")
      ).toBeInTheDocument();
      expect(niche).toHaveAttribute("aria-invalid", "true");
      expect(within(dialog).getByRole("textbox", { name: "Nome" })).not.toHaveAttribute(
        "aria-invalid"
      );
    });

    it("cor gravada fora da paleta não trava a edição do nome", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(jsonResponse({ ok: true, item: { ...ERP, name: "ERP Varejo 2" } }));
      // O banco só confere o formato da cor: "marrom" passa lá e não é da paleta.
      render(<ProductsManager products={[{ ...ERP, color: "marrom" }]} />);

      await user.click(screen.getByRole("button", { name: "Editar a fila ERP Varejo" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox", { name: "Nome" }), " 2");
      await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

      // Passar pelo envio é a prova: o seletor já mostra slate mesmo com o
      // valor cru no formulário, e só o zod recusaria "marrom".
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestOf(fetchMock).body).toEqual({ name: "ERP Varejo 2" });
      expect(within(dialog).queryByText("Cor inválida.")).not.toBeInTheDocument();
    });

    it("erro sem campo vira alerta no topo do formulário, não toast", async () => {
      const user = userEvent.setup();
      stubFetch(
        jsonResponse(
          { ok: false, code: "internal", message: "Não foi possível concluir a operação." },
          500
        )
      );
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Editar a fila ERP Varejo" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox", { name: "Nome" }), " 2");
      await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "Não foi possível concluir a operação."
      );
      expect(toastMock.error).not.toHaveBeenCalled();
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  describe("arquivar e reativar", () => {
    it("arquivar pede confirmação na linha antes de gravar e manda {archived:true}", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(
        jsonResponse({ ok: true, item: { ...ERP, archived_at: "2026-09-26T12:00:00+00:00" } })
      );
      render(<ProductsManager products={[ERP, WEB]} />);

      await user.click(screen.getByRole("button", { name: "Arquivar a fila ERP Varejo" }));

      const row = rowOf("ERP Varejo");
      const confirmation = within(row).getByRole("group", { name: ARCHIVE_QUESTION });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(within(confirmation).getByRole("button", { name: "Cancelar" })).toHaveFocus();
      // A pergunta vale só para esta linha.
      expect(within(rowOf("Suporte Web")).queryByText(ARCHIVE_QUESTION)).not.toBeInTheDocument();

      await user.click(within(confirmation).getByRole("button", { name: "Arquivar" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestOf(fetchMock)).toEqual({
        url: `/api/products/${ERP_ID}`,
        method: "PATCH",
        body: { archived: true },
      });
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(toastMock.success).toHaveBeenCalledWith("Fila arquivada.");
    });

    it("Cancelar e Esc desfazem a confirmação sem gravar", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch();
      render(<ProductsManager products={[ERP]} />);

      const archive = screen.getByRole("button", { name: "Arquivar a fila ERP Varejo" });
      await user.click(archive);
      await user.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByText(ARCHIVE_QUESTION)).not.toBeInTheDocument();
      // O foco volta ao botão da linha.
      expect(screen.getByRole("button", { name: "Arquivar a fila ERP Varejo" })).toHaveFocus();

      await user.click(screen.getByRole("button", { name: "Arquivar a fila ERP Varejo" }));
      expect(screen.getByText(ARCHIVE_QUESTION)).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByText(ARCHIVE_QUESTION)).not.toBeInTheDocument();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("dois cliques no confirmar antes de o botão desabilitar gravam uma vez só", async () => {
      const user = userEvent.setup();
      const { fetchMock, release } = deferredFetch();
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Arquivar a fila ERP Varejo" }));
      const confirm = screen.getByRole("button", { name: "Arquivar" });
      act(() => {
        fireEvent.click(confirm);
        fireEvent.click(confirm);
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await act(async () => release(jsonResponse({ ok: true, item: ERP })));
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falha ao arquivar fica na linha, com a mensagem da rota", async () => {
      const user = userEvent.setup();
      stubFetch(
        jsonResponse({ ok: false, code: "not_found", message: "Fila não encontrada." }, 404)
      );
      render(<ProductsManager products={[ERP]} />);

      await user.click(screen.getByRole("button", { name: "Arquivar a fila ERP Varejo" }));
      await user.click(screen.getByRole("button", { name: "Arquivar" }));

      expect(await within(rowOf("ERP Varejo")).findByRole("alert")).toHaveTextContent(
        "Fila não encontrada."
      );
      expect(refreshMock).not.toHaveBeenCalled();
      expect(toastMock.success).not.toHaveBeenCalled();
    });

    it("reativar confirma na linha, sem botão destrutivo, e manda {archived:false}", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(jsonResponse({ ok: true, item: { ...OLD, archived_at: null } }));
      render(<ProductsManager products={[ERP, OLD]} />);

      await user.click(screen.getByRole("button", { name: "Reativar a fila PDV Antigo" }));

      const confirmation = within(rowOf("PDV Antigo")).getByRole("group", { name: RESTORE_QUESTION });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(within(confirmation).getByRole("button", { name: "Cancelar" })).toHaveFocus();
      const confirm = within(confirmation).getByRole("button", { name: "Reativar" });
      expect(confirm).not.toHaveClass("text-destructive");

      await user.click(confirm);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestOf(fetchMock)).toEqual({
        url: `/api/products/${OLD_ID}`,
        method: "PATCH",
        body: { archived: false },
      });
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(toastMock.success).toHaveBeenCalledWith("Fila reativada.");
    });

    it("reativar com o nome já usado por outra fila ativa cita essa fila na linha", async () => {
      const user = userEvent.setup();
      stubFetch(
        jsonResponse(
          {
            ok: false,
            code: "duplicate",
            message: "Já existe uma fila com este nome.",
            errors: { name: ["Já existe uma fila com este nome."] },
            item: { ...ERP, name: "PDV antigo" },
          },
          409
        )
      );
      render(<ProductsManager products={[ERP, OLD]} />);

      await user.click(screen.getByRole("button", { name: "Reativar a fila PDV Antigo" }));
      await user.click(screen.getByRole("button", { name: "Reativar" }));

      expect(await within(rowOf("PDV Antigo")).findByRole("alert")).toHaveTextContent(
        "Já existe a fila ativa «PDV antigo». Renomeie uma das duas para reativar esta."
      );
      expect(refreshMock).not.toHaveBeenCalled();

      // Renomear é a saída: abrir o formulário tira o aviso da linha.
      await user.click(screen.getByRole("button", { name: "Editar a fila PDV Antigo" }));
      await screen.findByRole("dialog");
      // `hidden`: com o diálogo aberto, o resto da página sai da árvore acessível.
      expect(
        within(rowOf("PDV Antigo")).queryByRole("alert", { hidden: true })
      ).not.toBeInTheDocument();
    });

    it("sem rede, a linha diz que não gravou", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
      render(<ProductsManager products={[OLD]} />);

      await user.click(screen.getByRole("button", { name: "Reativar a fila PDV Antigo" }));
      await user.click(screen.getByRole("button", { name: "Reativar" }));

      expect(await within(rowOf("PDV Antigo")).findByRole("alert")).toHaveTextContent(
        "Não foi possível reativar a fila. Confira a conexão e tente de novo."
      );
    });
  });
});
