import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useContactInfo } from "@/features/chat/hooks/use-contact-info";
import type { ContactInfo } from "@/features/chat/lib/contact-info";
import type { CustomerSummary } from "@/features/customers/types";

const CONVERSATION_ID = "conv-1";
const CONTACT_ID = "contact-1";

const PADARIA: CustomerSummary = {
  id: "c1",
  legal_name: "Padaria S. João Ltda",
  trade_name: "Padaria São João",
  cnpj: "12ABC34501DE35",
  contract_status: "ativo",
  archived_at: null,
};

const MERCADO: CustomerSummary = {
  id: "c2",
  legal_name: "Mercado Bom Preço Ltda",
  trade_name: null,
  cnpj: null,
  contract_status: "suspenso",
  archived_at: null,
};

function infoWith(customer: CustomerSummary | null): ContactInfo {
  return {
    contact: {
      id: CONTACT_ID,
      email: null,
      notes: "Cliente antigo",
      created_at: "2026-09-01T12:00:00.000Z",
    },
    customer,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { url: string; init?: RequestInit };

/**
 * A leitura do painel responde `info`; o PATCH do contato responde `patch`.
 * Cada chamada recebe uma Response nova: o corpo só pode ser lido uma vez.
 */
function stubFetch(info: ContactInfo, patch: () => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === `/api/chat/conversations/${CONVERSATION_ID}/contact`) {
        return jsonResponse(info);
      }
      if (url === `/api/contacts/${CONTACT_ID}` && init?.method === "PATCH") {
        return patch();
      }
      throw new Error(`fetch inesperado: ${url}`);
    })
  );
  return calls;
}

async function renderLoaded() {
  const hook = renderHook(() => useContactInfo(CONVERSATION_ID));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useContactInfo — linkCustomer", () => {
  it("manda só o customer_id no PATCH do contato", async () => {
    const calls = stubFetch(infoWith(null), () =>
      jsonResponse({ ok: true, message: "Contato atualizado." })
    );
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.linkCustomer(PADARIA);
    });

    const patch = calls.find((call) => call.init?.method === "PATCH");
    expect(patch?.url).toBe(`/api/contacts/${CONTACT_ID}`);
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ customer_id: "c1" });
  });

  it("desligar manda customer_id null", async () => {
    const calls = stubFetch(infoWith(PADARIA), () => jsonResponse({ ok: true }));
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.linkCustomer(null);
    });

    const patch = calls.find((call) => call.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ customer_id: null });
    expect(result.current.info?.customer).toBeNull();
  });

  it("no sucesso espelha a empresa escolhida, com o selo, sem buscar o painel de novo", async () => {
    const calls = stubFetch(infoWith(PADARIA), () => jsonResponse({ ok: true }));
    const { result } = await renderLoaded();

    let outcome: Awaited<ReturnType<typeof result.current.linkCustomer>> | undefined;
    await act(async () => {
      outcome = await result.current.linkCustomer(MERCADO);
    });

    expect(outcome).toEqual({ ok: true });
    expect(result.current.info?.customer).toEqual(MERCADO);
    expect(result.current.info?.customer?.contract_status).toBe("suspenso");
    // As notas continuam lá: o espelho só troca a empresa.
    expect(result.current.info?.contact?.notes).toBe("Cliente antigo");
    expect(result.current.loading).toBe(false);
    expect(result.current.linking).toBe(false);
    // Uma leitura (ao abrir) e um PATCH — nenhuma segunda leitura.
    expect(calls.map((call) => call.init?.method ?? "GET")).toEqual(["GET", "PATCH"]);
  });

  it("na falha preserva a empresa atual e devolve a mensagem do servidor", async () => {
    stubFetch(infoWith(PADARIA), () =>
      jsonResponse(
        {
          ok: false,
          message: "Revise os campos destacados.",
          errors: { customer_id: ["Empresa arquivada. Reative-a antes."] },
        },
        422
      )
    );
    const { result } = await renderLoaded();

    let outcome: Awaited<ReturnType<typeof result.current.linkCustomer>> | undefined;
    await act(async () => {
      outcome = await result.current.linkCustomer(MERCADO);
    });

    expect(outcome).toEqual({ ok: false, message: "Empresa arquivada. Reative-a antes." });
    expect(result.current.info?.customer).toEqual(PADARIA);
    expect(result.current.linking).toBe(false);
  });

  it("falha de rede também preserva o estado", async () => {
    stubFetch(infoWith(PADARIA), () => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = await renderLoaded();

    let outcome: Awaited<ReturnType<typeof result.current.linkCustomer>> | undefined;
    await act(async () => {
      outcome = await result.current.linkCustomer(null);
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toBeTruthy();
    expect(result.current.info?.customer).toEqual(PADARIA);
    expect(result.current.linking).toBe(false);
  });

  it("sem contato cadastrado não chama a rota", async () => {
    const calls = stubFetch({ contact: null, customer: null }, () => jsonResponse({ ok: true }));
    const { result } = await renderLoaded();

    let outcome: Awaited<ReturnType<typeof result.current.linkCustomer>> | undefined;
    await act(async () => {
      outcome = await result.current.linkCustomer(PADARIA);
    });

    expect(outcome).toEqual({ ok: false });
    expect(calls.some((call) => call.init?.method === "PATCH")).toBe(false);
  });
});
