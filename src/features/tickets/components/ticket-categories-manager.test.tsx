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

import { TicketCategoriesManager } from "@/features/tickets/components/ticket-categories-manager";
import type { ProductOption } from "@/features/products/types";
import type { TicketCategoryOption } from "@/features/tickets/types";

const ERP_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const PDV_ID = "8f14e45f-ceea-4e67-a3b1-9c0d1e2f3a4b";
const OLD_ID = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";

const ARCHIVED_AT = "2026-09-01T12:00:00.000000+00:00";

const PRODUCTS: ProductOption[] = [
  { id: ERP_ID, name: "ERP Varejo", niche: null, color: "blue", archived_at: null },
  { id: PDV_ID, name: "PDV", niche: null, color: "green", archived_at: null },
  { id: OLD_ID, name: "Sistema antigo", niche: null, color: "gray", archived_at: ARCHIVED_AT },
];

function category(
  id: string,
  name: string,
  productId: string | null,
  parentId: string | null = null,
  archivedAt: string | null = null
): TicketCategoryOption {
  return { id, name, product_id: productId, parent_id: parentId, archived_at: archivedAt };
}

const DUVIDA = category("0f8fad5b-d9cb-469f-a165-70867728950e", "Dúvida", null);
const NOTAS = category("7c9e6679-7425-40de-944b-e07fc1f90ae7", "Notas fiscais", ERP_ID);
const REJEICAO = category("11111111-1111-4111-8111-111111111111", "Rejeição", ERP_ID, NOTAS.id);
const IMPRESSAO = category(
  "22222222-2222-4222-8222-222222222222",
  "Impressão",
  ERP_ID,
  null,
  ARCHIVED_AT
);
const CUPOM = category(
  "33333333-3333-4333-8333-333333333333",
  "Cupom",
  ERP_ID,
  IMPRESSAO.id,
  ARCHIVED_AT
);
const CAIXA = category("44444444-4444-4444-8444-444444444444", "Caixa", PDV_ID);
const RELATORIOS = category(
  "55555555-5555-4555-8555-555555555555",
  "Relatórios",
  OLD_ID,
  null,
  ARCHIVED_AT
);
const BACKUP = category("66666666-6666-4666-8666-666666666666", "Backup", ERP_ID, null, ARCHIVED_AT);

// Por nome, como a leitura entrega.
const CATEGORIES: TicketCategoryOption[] = [
  BACKUP,
  CAIXA,
  CUPOM,
  DUVIDA,
  IMPRESSAO,
  NOTAS,
  REJEICAO,
  RELATORIOS,
];

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

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
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

function renderManager(
  props: Partial<Parameters<typeof TicketCategoriesManager>[0]> = {}
) {
  return render(
    <TicketCategoriesManager categories={CATEGORIES} products={PRODUCTS} {...props} />
  );
}

function group(name: string) {
  return screen.getByRole("region", { name });
}

describe("TicketCategoriesManager — lista", () => {
  it("agrupa por fila, com as gerais primeiro, e põe a filha sob a mãe", () => {
    renderManager();

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Sem fila", "ERP Varejo", "PDV", "Sistema antigo"]);

    const children = within(group("ERP Varejo")).getByRole("list", {
      name: "Subcategorias de Notas fiscais",
    });
    expect(within(children).getByText("Rejeição")).toBeInTheDocument();
    expect(within(group("Sem fila")).getByText("Aparecem em todas as filas.")).toBeInTheDocument();
  });

  it("marca a fila e as categorias arquivadas", () => {
    renderManager();

    expect(within(group("Sistema antigo")).getAllByText("Arquivada")).toHaveLength(2);
    expect(within(group("PDV")).queryByText("Arquivada")).toBeNull();
  });

  it("não oferece reativar categoria de fila arquivada e explica o porquê", () => {
    renderManager();

    const archivedQueue = group("Sistema antigo");
    expect(within(archivedQueue).queryByRole("button", { name: /Reativar/ })).toBeNull();
    expect(
      within(archivedQueue).getByText("Fila arquivada: reative a fila antes.")
    ).toBeInTheDocument();
    // Renomear continua: o banco aceita.
    expect(
      within(archivedQueue).getByRole("button", { name: "Renomear Relatórios" })
    ).toBeInTheDocument();
    // Na fila ativa, a arquivada reativa.
    expect(screen.getByRole("button", { name: "Reativar Backup" })).toBeInTheDocument();
  });

  it("não oferece reativar a filha de mãe arquivada", () => {
    renderManager();

    expect(screen.queryByRole("button", { name: "Reativar Cupom" })).toBeNull();
    expect(screen.getByText("Mãe arquivada: reative “Impressão” antes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reativar Impressão" })).toBeInTheDocument();
  });

  it("categoria de fila que não veio na leitura não some", () => {
    const orphan = category(
      "77777777-7777-4777-8777-777777777777",
      "Integração",
      "88888888-8888-4888-8888-888888888888"
    );
    renderManager({ categories: [orphan] });

    expect(within(group("Fila não encontrada")).getByText("Integração")).toBeInTheDocument();
  });
});

describe("TicketCategoriesManager — estados", () => {
  it.each([
    ["categorias", { categories: null }, "Não foi possível carregar as categorias."],
    ["filas", { products: null }, "Não foi possível carregar as filas das categorias."],
  ] as const)("falha ao ler as %s: diz que falhou e oferece Tentar de novo", async (_part, props, text) => {
    const user = userEvent.setup();
    renderManager(props);

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma categoria ainda.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova categoria" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("base vazia diz que não há categoria e deixa criar", () => {
    renderManager({ categories: [] });

    expect(screen.getByText("Nenhuma categoria ainda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova categoria" })).toBeInTheDocument();
  });
});

describe("TicketCategoriesManager — criar", () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Nova categoria" }));
    return screen.findByRole("dialog", { name: "Nova categoria" });
  }

  async function choose(
    user: ReturnType<typeof userEvent.setup>,
    field: string,
    option: string
  ) {
    await user.click(screen.getByRole("combobox", { name: field }));
    await user.click(await screen.findByRole("option", { name: option }));
  }

  it("a mãe só lista as principais ativas da mesma fila", async () => {
    const user = userEvent.setup();
    renderManager();
    await openCreate(user);

    await user.click(screen.getByRole("combobox", { name: "Categoria mãe" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Nenhuma (categoria principal)",
      "Dúvida",
    ]);
    await user.click(screen.getByRole("option", { name: "Nenhuma (categoria principal)" }));

    await choose(user, "Fila", "ERP Varejo");
    await user.click(screen.getByRole("combobox", { name: "Categoria mãe" }));
    // Sem Impressão (arquivada), Rejeição (filha) e Caixa (outra fila).
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Nenhuma (categoria principal)",
      "Notas fiscais",
    ]);
  });

  it("a fila arquivada não é oferecida", async () => {
    const user = userEvent.setup();
    renderManager();
    await openCreate(user);

    await user.click(screen.getByRole("combobox", { name: "Fila" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Sem fila",
      "ERP Varejo",
      "PDV",
    ]);
  });

  it("criar filha manda o product_id da mãe, relê e fecha", async () => {
    const user = userEvent.setup();
    const created = category("99999999-9999-4999-8999-999999999999", "Denegada", ERP_ID, NOTAS.id);
    const fetchMock = stubFetch(jsonResponse({ ok: true, item: created }, 201));
    renderManager();
    await openCreate(user);

    await user.type(screen.getByLabelText(/^Nome/), "  Denegada ");
    await choose(user, "Fila", "ERP Varejo");
    await choose(user, "Categoria mãe", "Notas fiscais");
    await user.click(screen.getByRole("button", { name: "Criar categoria" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: "/api/ticket-categories",
      method: "POST",
      body: { name: "Denegada", product_id: ERP_ID, parent_id: NOTAS.id },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toastMock.success).toHaveBeenCalledWith("Categoria criada.");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("trocar a fila tira a mãe que não é dela", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse({ ok: true, item: category(DUVIDA.id, "Caixa lento", PDV_ID) }, 201)
    );
    renderManager();
    await openCreate(user);

    await user.type(screen.getByLabelText(/^Nome/), "Caixa lento");
    await choose(user, "Fila", "ERP Varejo");
    await choose(user, "Categoria mãe", "Notas fiscais");
    await choose(user, "Fila", "PDV");
    await user.click(screen.getByRole("button", { name: "Criar categoria" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({
      name: "Caixa lento",
      product_id: PDV_ID,
      parent_id: null,
    });
  });

  it("nome repetido marca o campo e cita a categoria que já existe", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "duplicate",
          message: "Já existe uma categoria com este nome.",
          errors: { name: ["Já existe uma categoria com este nome."] },
          item: REJEICAO,
        },
        409
      )
    );
    renderManager();
    await openCreate(user);

    await user.type(screen.getByLabelText(/^Nome/), "rejeição");
    await choose(user, "Fila", "ERP Varejo");
    await choose(user, "Categoria mãe", "Notas fiscais");
    await user.click(screen.getByRole("button", { name: "Criar categoria" }));

    const name = screen.getByLabelText(/^Nome/);
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(name).toHaveAccessibleDescription(
      "Já existe uma categoria com este nome: ERP Varejo › Notas fiscais › Rejeição."
    );
    expect(screen.getByRole("dialog", { name: "Nova categoria" })).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("422 do banco vai para o campo da mãe", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "category_archived",
          message: "Categoria mãe arquivada. Reative-a antes.",
          errors: { parent_id: ["Categoria mãe arquivada. Reative-a antes."] },
        },
        422
      )
    );
    renderManager();
    await openCreate(user);

    await user.type(screen.getByLabelText(/^Nome/), "Denegada");
    await choose(user, "Fila", "ERP Varejo");
    await choose(user, "Categoria mãe", "Notas fiscais");
    await user.click(screen.getByRole("button", { name: "Criar categoria" }));

    const parent = screen.getByRole("combobox", { name: "Categoria mãe" });
    await waitFor(() => expect(parent).toHaveAttribute("aria-invalid", "true"));
    expect(parent).toHaveAccessibleDescription("Categoria mãe arquivada. Reative-a antes.");
  });

  it("erro sem campo vira alerta no topo do formulário", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse({ ok: false, code: "internal", message: "Não foi possível concluir a operação." }, 500)
    );
    renderManager();
    const dialog = await openCreate(user);

    await user.type(screen.getByLabelText(/^Nome/), "Denegada");
    await user.click(screen.getByRole("button", { name: "Criar categoria" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Não foi possível concluir a operação."
    );
  });

  it("dois cliques em Criar categoria antes de o botão desabilitar fazem um envio só", async () => {
    const user = userEvent.setup();
    const { fetchMock, release } = deferredFetch();
    renderManager();
    await openCreate(user);

    await user.type(screen.getByLabelText(/^Nome/), "Denegada");
    await choose(user, "Fila", "ERP Varejo");
    const submit = screen.getByRole("button", { name: "Criar categoria" });
    // No mesmo tique: o React ainda não desenhou o `disabled` do 1º envio.
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () =>
      release(jsonResponse({ ok: true, item: category(DUVIDA.id, "Denegada", ERP_ID) }, 201))
    );
    // O 2º envio passaria pelo resolver assíncrono depois do 1º: a contagem
    // só vale depois da resposta.
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("nome curto não sai do formulário", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true }));
    renderManager();
    await openCreate(user);

    await user.type(screen.getByLabelText(/^Nome/), "a");
    await user.click(screen.getByRole("button", { name: "Criar categoria" }));

    expect(await screen.findByText("Use ao menos 2 caracteres.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TicketCategoriesManager — arquivar, reativar e renomear", () => {
  it("arquivar pede confirmação na linha e só grava no segundo clique", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse({ ok: true, item: { ...CAIXA, archived_at: ARCHIVED_AT } })
    );
    renderManager();

    await user.click(screen.getByRole("button", { name: "Arquivar Caixa" }));
    const confirmation = screen.getByRole("group", { name: "Arquivar Caixa" });
    expect(within(confirmation).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(confirmation).getByRole("button", { name: "Arquivar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/ticket-categories/${CAIXA.id}`,
      method: "PATCH",
      body: { archived: true },
    });
    expect(toastMock.success).toHaveBeenCalledWith("Categoria arquivada.");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("group", { name: "Arquivar Caixa" })).toBeNull());
    expect(screen.getByRole("button", { name: "Arquivar Caixa" })).toHaveFocus();
  });

  it("dois cliques no Arquivar da confirmação gravam uma vez só", async () => {
    const user = userEvent.setup();
    const { fetchMock, release } = deferredFetch();
    renderManager();

    await user.click(screen.getByRole("button", { name: "Arquivar Caixa" }));
    const confirm = within(screen.getByRole("group", { name: "Arquivar Caixa" })).getByRole(
      "button",
      { name: "Arquivar" }
    );
    // No mesmo tique: o React ainda não desenhou o `disabled` do 1º envio.
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () =>
      release(jsonResponse({ ok: true, item: { ...CAIXA, archived_at: ARCHIVED_AT } }))
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("Esc desiste da confirmação sem gravar", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true }));
    renderManager();

    await user.click(screen.getByRole("button", { name: "Arquivar Caixa" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: "Arquivar Caixa" })).toBeNull();
    // O foco volta ao botão que abriu a confirmação.
    expect(screen.getByRole("button", { name: "Arquivar Caixa" })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("arquivar mãe com filha ativa mostra o erro do banco na linha", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "category_has_active_children",
          message: "Arquive as subcategorias antes da categoria.",
          errors: { archived: ["Arquive as subcategorias antes da categoria."] },
        },
        422
      )
    );
    renderManager();

    await user.click(screen.getByRole("button", { name: "Arquivar Notas fiscais" }));
    await user.click(
      within(screen.getByRole("group", { name: "Arquivar Notas fiscais" })).getByRole("button", {
        name: "Arquivar",
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Arquive as subcategorias antes da categoria."
    );
    expect(screen.getByRole("button", { name: "Arquivar Notas fiscais" })).toHaveAccessibleDescription(
      "Arquive as subcategorias antes da categoria."
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reativar manda archived: false", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true, item: { ...BACKUP, archived_at: null } }));
    renderManager();

    await user.click(screen.getByRole("button", { name: "Reativar Backup" }));
    await user.click(
      within(screen.getByRole("group", { name: "Reativar Backup" })).getByRole("button", {
        name: "Reativar",
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({ archived: false });
    expect(toastMock.success).toHaveBeenCalledWith("Categoria reativada.");
  });

  it("reativar com nome já usado cita a categoria ativa", async () => {
    const user = userEvent.setup();
    const active = category("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "backup", ERP_ID);
    stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "duplicate",
          message: "Já existe uma categoria com este nome.",
          errors: { name: ["Já existe uma categoria com este nome."] },
          item: active,
        },
        409
      )
    );
    renderManager();

    await user.click(screen.getByRole("button", { name: "Reativar Backup" }));
    await user.click(
      within(screen.getByRole("group", { name: "Reativar Backup" })).getByRole("button", {
        name: "Reativar",
      })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Já existe uma categoria com este nome: ERP Varejo › backup."
    );
  });

  it("renomear manda só o nome e fecha o campo", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true, item: { ...CAIXA, name: "Frente de caixa" } }));
    renderManager();

    await user.click(screen.getByRole("button", { name: "Renomear Caixa" }));
    const input = screen.getByLabelText("Novo nome de Caixa");
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "Frente de caixa{Enter}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: `/api/ticket-categories/${CAIXA.id}`,
      method: "PATCH",
      body: { name: "Frente de caixa" },
    });
    expect(toastMock.success).toHaveBeenCalledWith("Categoria renomeada.");
    await waitFor(() => expect(screen.queryByLabelText("Novo nome de Caixa")).toBeNull());
  });

  it("renomear para o mesmo nome não grava", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true }));
    renderManager();

    await user.click(screen.getByRole("button", { name: "Renomear Caixa" }));
    await user.type(screen.getByLabelText("Novo nome de Caixa"), " {Enter}");

    await waitFor(() => expect(screen.queryByLabelText("Novo nome de Caixa")).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Renomear Caixa" })).toHaveFocus();
  });

  it("Esc desiste de renomear", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ ok: true }));
    renderManager();

    await user.click(screen.getByRole("button", { name: "Renomear Caixa" }));
    await user.type(screen.getByLabelText("Novo nome de Caixa"), " lento{Escape}");

    expect(screen.queryByLabelText("Novo nome de Caixa")).toBeNull();
    expect(screen.getByRole("button", { name: "Renomear Caixa" })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nome repetido ao renomear vai para o campo", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse(
        {
          ok: false,
          code: "duplicate",
          message: "Já existe uma categoria com este nome.",
          errors: { name: ["Já existe uma categoria com este nome."] },
          // Criada em outra aba depois da leitura: a tela ainda não a tem.
          item: category("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Frente de caixa", PDV_ID),
        },
        409
      )
    );
    renderManager();

    await user.click(screen.getByRole("button", { name: "Renomear Caixa" }));
    const input = screen.getByLabelText("Novo nome de Caixa");
    await user.clear(input);
    await user.type(input, "frente de caixa{Enter}");

    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription(
      "Já existe uma categoria com este nome: PDV › Frente de caixa."
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("nome recusado com a resposta demorando leva o foco ao campo", async () => {
    const user = userEvent.setup();
    const { fetchMock, release } = deferredFetch();
    renderManager();

    await user.click(screen.getByRole("button", { name: "Renomear Caixa" }));
    const input = screen.getByLabelText("Novo nome de Caixa");
    await user.clear(input);
    await user.type(input, "Dúvida");
    await user.click(screen.getByRole("button", { name: "Salvar nome" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Em voo o campo fica só leitura: desabilitado, ele perderia o foco e o
    // `shouldFocus` da resposta não o traria de volta.
    await waitFor(() => expect(input).toHaveAttribute("readonly"));
    expect(input).toBeEnabled();
    await act(async () =>
      release(
        jsonResponse(
          {
            ok: false,
            code: "duplicate",
            message: "Já existe uma categoria com este nome.",
            errors: { name: ["Já existe uma categoria com este nome."] },
          },
          409
        )
      )
    );

    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute("readonly");
  });

  it("categoria que saiu da base avisa e relê", async () => {
    const user = userEvent.setup();
    stubFetch(jsonResponse({ ok: false, code: "not_found", message: "Categoria não encontrada." }, 404));
    renderManager();

    await user.click(screen.getByRole("button", { name: "Arquivar Caixa" }));
    await user.click(
      within(screen.getByRole("group", { name: "Arquivar Caixa" })).getByRole("button", {
        name: "Arquivar",
      })
    );

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Categoria não encontrada."));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
