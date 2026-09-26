import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CustomerPicker } from "@/features/customers/components/customer-picker";
import type { CustomerSummary } from "@/features/customers/types";

const PADARIA: CustomerSummary = {
  id: "c1",
  legal_name: "Padaria S. João Ltda",
  trade_name: "Padaria São João",
  cnpj: "12ABC34501DE35",
  contract_status: "suspenso",
  archived_at: null,
};

const MERCADO: CustomerSummary = {
  id: "c2",
  legal_name: "Mercado Bom Preço Ltda",
  trade_name: null,
  cnpj: null,
  contract_status: null,
  archived_at: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Cada chamada recebe uma Response nova: o corpo só pode ser lido uma vez. */
function stubFetch(...responses: Array<() => Response>) {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => {
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return next!();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// O texto também vai, oculto, para o anúncio do leitor de tela: aqui vale o visível.
const VISIBLE = { ignore: ".sr-only, script, style" };

const requestedUrls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([url]) => new URL(url, "http://localhost"));

function setup(props: Partial<Parameters<typeof CustomerPicker>[0]> = {}) {
  const onPick = vi.fn();
  render(
    <CustomerPicker
      appearance="app"
      currentCustomerId={null}
      busyId={null}
      onPick={onPick}
      {...props}
    />
  );
  return { onPick, user: userEvent.setup() };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("CustomerPicker", () => {
  it("busca ao abrir e mostra nome, razão social · CNPJ e o selo com texto", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, items: [PADARIA, MERCADO] }));
    setup();

    expect(await screen.findByText("Padaria São João")).toBeTruthy();
    expect(screen.getByText("Padaria S. João Ltda · 12.ABC.345/01DE-35")).toBeTruthy();
    expect(screen.getByText("Contrato suspenso")).toBeTruthy();
    // Sem contrato também é texto, não só ausência de cor.
    expect(screen.getByText("Sem contrato")).toBeTruthy();
    expect(screen.getByText("2 empresas")).toBeTruthy();

    const [first] = requestedUrls(fetchMock);
    expect(first.pathname).toBe("/api/customers");
    expect(first.searchParams.get("q")).toBeNull();
    expect(first.searchParams.get("limit")).toBe("20");
  });

  it("espera a pessoa parar de digitar: uma busca pelo termo, não uma por tecla", async () => {
    const fetchMock = stubFetch(
      () => jsonResponse({ ok: true, items: [PADARIA, MERCADO] }),
      () => jsonResponse({ ok: true, items: [PADARIA] })
    );
    const { user } = setup();
    await screen.findByText("Mercado Bom Preço Ltda");

    await user.type(screen.getByRole("searchbox", { name: "Buscar empresa" }), "pad");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestedUrls(fetchMock)[1].searchParams.get("q")).toBe("pad");
    await waitFor(() => expect(screen.queryByText("Mercado Bom Preço Ltda")).toBeNull());
    expect(screen.getByText("1 empresa")).toBeTruthy();
    // Nenhuma busca a mais chega depois do debounce.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a escolha entrega o objeto da empresa", async () => {
    stubFetch(() => jsonResponse({ ok: true, items: [PADARIA, MERCADO] }));
    const { user, onPick } = setup();

    await user.click(await screen.findByRole("button", { name: /Mercado Bom Preço Ltda/ }));

    expect(onPick).toHaveBeenCalledWith(MERCADO);
  });

  it("empresa atual aparece como Atual e não é escolhível; Desligar mostra o nome", async () => {
    stubFetch(() => jsonResponse({ ok: true, items: [PADARIA, MERCADO] }));
    const onUnlink = vi.fn();
    const { user, onPick } = setup({
      currentCustomerId: "c1",
      currentCustomerName: "Padaria São João",
      onUnlink,
    });

    const current = await screen.findByRole("button", { name: /Padaria São João.*Atual/ });
    expect((current as HTMLButtonElement).disabled).toBe(true);
    await user.click(current);
    expect(onPick).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Desligar de Padaria São João" }));
    expect(onUnlink).toHaveBeenCalledOnce();
  });

  it("escrita em voo trava a lista inteira", async () => {
    stubFetch(() => jsonResponse({ ok: true, items: [PADARIA, MERCADO] }));
    setup({ busyId: "c2" });

    const other = await screen.findByRole("button", { name: /Padaria São João/ });
    expect((other as HTMLButtonElement).disabled).toBe(true);
  });

  it("erro não vira 'nenhuma empresa': mostra a falha, e Tentar de novo busca outra vez", async () => {
    const fetchMock = stubFetch(
      () => jsonResponse({ ok: false, message: "Não foi possível buscar as empresas." }, 500),
      () => jsonResponse({ ok: true, items: [PADARIA] })
    );
    const { user } = setup();

    expect(await screen.findByText("Não foi possível buscar as empresas.", VISIBLE)).toBeTruthy();
    expect(screen.queryByText("Nenhuma empresa encontrada.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("Padaria São João")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lista vazia oferece cadastrar em Clientes", async () => {
    stubFetch(() => jsonResponse({ ok: true, items: [] }));
    setup();

    expect(await screen.findByText("Nenhuma empresa encontrada.", VISIBLE)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cadastrar em Clientes" }).getAttribute("href")).toBe(
      "/app/clientes"
    );
  });
});
