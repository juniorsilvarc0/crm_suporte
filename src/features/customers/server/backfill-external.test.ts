// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { contextMock } = vi.hoisted(() => ({ contextMock: vi.fn() }));
vi.mock("@/features/customer-source/get-customer-context", () => ({ getCustomerContext: contextMock }));

import { backfillExternalCustomers } from "@/features/customers/server/backfill-external";

// Contexto de um cliente PJ (TCBX), por telefone.
const pj = (documento: string, razao = "EMPRESA LTDA") => ({
  state: "ok" as const,
  context: { externalId: "1", documento, razaoSocial: razao, nomeFantasia: "FANTASIA", tipoPessoa: "PJ", contratos: [], titulosEmAberto: [] },
});

type Contact = { id: string; phone: string };

/** Mock encadeável do supabase: lista de contatos, empresas existentes por CNPJ, e captura das escritas. */
function makeClient(contacts: Contact[], existingCnpjs: Record<string, string> = {}) {
  const inserts: Record<string, unknown>[] = [];
  const links: { id: string; customer_id: string | null }[] = [];
  let newId = 0;

  const client = {
    from(table: string) {
      if (table === "contacts") {
        let updateValues: { customer_id: string | null } | null = null;
        let updateId: string | null = null;
        return {
          select: () => builder,
          update(values: { customer_id: string | null }) {
            updateValues = values;
            return {
              eq: (_c: string, id: string) => {
                updateId = id;
                return { is: () => { links.push({ id: updateId!, customer_id: updateValues!.customer_id }); return Promise.resolve({ error: null }); } };
              },
            };
          },
        } as const;
      }
      // customers: select/eq/is encadeiam no PRÓPRIO objeto (capturando o CNPJ);
      // maybeSingle e insert terminam.
      let cnpj = "";
      const customers = {
        select: () => customers,
        eq: (_c: string, value: string) => {
          cnpj = value;
          return customers;
        },
        is: () => customers,
        maybeSingle: () =>
          Promise.resolve({ data: existingCnpjs[cnpj] ? { id: existingCnpjs[cnpj] } : null, error: null }),
        insert: (values: Record<string, unknown>) => {
          inserts.push(values);
          const id = `new-${(newId += 1)}`;
          return { select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }) };
        },
      };
      return customers;
    },
  };

  // Builder da LISTAGEM de contacts: select→is→is→order→limit.
  const builder: Record<string, (...args: unknown[]) => unknown> = {
    select: () => builder,
    is: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: contacts, error: null }),
  };
  // Builder de customers (select/eq/is encadeiam; maybeSingle/insert terminam) —
  // resolvido dentro do from(), este é só para o encadeamento do select.

  return { client, inserts, links };
}

const run = (client: unknown, apply: boolean, limit?: number) =>
  backfillExternalCustomers(client as never, { apply, limit, createdBy: "admin-1" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backfillExternalCustomers", () => {
  it("por contato: PJ cria empresa e vincula; PF é pulado; não encontrado conta", async () => {
    const { client, inserts, links } = makeClient([
      { id: "c1", phone: "558699783446" },
      { id: "c2", phone: "5511999990000" },
      { id: "c3", phone: "5511888880000" },
    ]);
    contextMock.mockImplementation(async ({ telefone }: { telefone: string }) => {
      if (telefone === "558699783446") return pj("12.321.030/0001-89");
      if (telefone === "5511999990000") return { state: "ok", context: { externalId: "2", documento: "123.456.789-00", razaoSocial: null, nomeFantasia: null, tipoPessoa: "PF", contratos: [], titulosEmAberto: [] } };
      return { state: "not_found" };
    });

    const report = await run(client, true);

    expect(report).toMatchObject({ processed: 3, created: 1, linked: 1, skippedPf: 1, notFound: 1, reused: 0, errors: 0, remaining: 0 });
    expect(inserts).toEqual([{ legal_name: "EMPRESA LTDA", trade_name: "FANTASIA", cnpj: "12321030000189", created_by_user_id: "admin-1" }]);
    expect(links).toEqual([{ id: "c1", customer_id: "new-1" }]);
  });

  it("ensaio (apply=false): conta o que faria, sem gravar", async () => {
    const { client, inserts, links } = makeClient([{ id: "c1", phone: "558699783446" }]);
    contextMock.mockResolvedValue(pj("12.321.030/0001-89"));

    const report = await run(client, false);

    expect(report).toMatchObject({ processed: 1, created: 1, linked: 1 });
    expect(inserts).toEqual([]);
    expect(links).toEqual([]);
  });

  it("empresa com o CNPJ já existe: reusa (não cria) e vincula", async () => {
    const { client, inserts, links } = makeClient([{ id: "c1", phone: "558699783446" }], { "12321030000189": "existe-1" });
    contextMock.mockResolvedValue(pj("12.321.030/0001-89"));

    const report = await run(client, true);

    expect(report).toMatchObject({ created: 0, reused: 1, linked: 1 });
    expect(inserts).toEqual([]);
    expect(links).toEqual([{ id: "c1", customer_id: "existe-1" }]);
  });

  it("a fonte indisponível conta como erro, não como 'sem cadastro'", async () => {
    const { client } = makeClient([{ id: "c1", phone: "558699783446" }]);
    contextMock.mockResolvedValue({ state: "unavailable" });

    expect((await run(client, true)).errors).toBe(1);
  });

  it("remaining: veio uma leva cheia + 1, então sobra 1", async () => {
    const contacts = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, phone: `5511${i}` }));
    const { client } = makeClient(contacts);
    contextMock.mockResolvedValue({ state: "not_found" });

    const report = await run(client, true, 2);

    expect(report.processed).toBe(2);
    expect(report.remaining).toBe(1);
  });
});
