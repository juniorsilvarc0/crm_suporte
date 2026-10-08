// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));
vi.mock("@/features/customer-source/resolve-by-phone", () => ({ resolveCustomerByPhone: resolveMock }));

import { backfillExternalCustomers } from "@/features/customers/server/backfill-external";

// Contexto de um cliente PJ (TCBX).
const pj = (documento: string, razao = "EMPRESA LTDA") => ({
  state: "ok" as const,
  context: {
    externalId: "1",
    documento,
    razaoSocial: razao,
    nomeFantasia: "FANTASIA",
    tipoPessoa: "PJ" as const,
    status: "ativo",
    emailPrincipal: null,
    emailFinanceiro: null,
    telefonePrincipal: null,
    telefoneSecundario: null,
    contratos: [],
    titulosEmAberto: [],
  },
});

type Contact = { id: string; phone: string };

/** Mock encadeável do supabase: lista de contatos (thenable), empresas por CNPJ, e captura das escritas. */
function makeClient(contacts: Contact[], existingCnpjs: Record<string, string> = {}) {
  const inserts: Record<string, unknown>[] = [];
  const links: { id: string; customer_id: string | null }[] = [];
  let newId = 0;

  // Builder da listagem: select/is/order/limit/gt encadeiam; o await resolve a lista.
  const listing = {
    select: () => listing,
    is: () => listing,
    order: () => listing,
    limit: () => listing,
    gt: () => listing,
    then: (resolve: (v: { data: Contact[]; error: null }) => void) => resolve({ data: contacts, error: null }),
  };

  const client = {
    from(table: string) {
      if (table === "contacts") {
        return {
          select: () => listing,
          update: (values: { customer_id: string | null }) => ({
            eq: (_c: string, id: string) => ({
              is: () => {
                links.push({ id, customer_id: values.customer_id });
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === "external_contracts") {
        // O backfill grava o espelho dos contratos (storeExternalContracts). O
        // contexto `pj()` traz `contratos: []`, então só o prune (delete) roda.
        const del = { eq: () => del, lt: () => Promise.resolve({ error: null }) };
        return { upsert: () => Promise.resolve({ error: null }), delete: () => del };
      }
      // customers
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

  return { client, inserts, links };
}

const run = (client: unknown, apply: boolean, limit?: number, after?: string) =>
  backfillExternalCustomers(client as never, { apply, limit, after, createdBy: "admin-1" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backfillExternalCustomers", () => {
  it("por telefone: PJ cria empresa e vincula; PF pulado; não encontrado e ambíguo contam", async () => {
    const { client, inserts, links } = makeClient([
      { id: "c1", phone: "558699783446" },
      { id: "c2", phone: "5511999990000" },
      { id: "c3", phone: "5511888880000" },
      { id: "c4", phone: "5511777770000" },
    ]);
    resolveMock.mockImplementation(async (phone: string) => {
      if (phone === "558699783446") return pj("12.321.030/0001-89");
      if (phone === "5511999990000")
        return { state: "ok", context: { ...pj("1").context, documento: "123.456.789-00", tipoPessoa: "PF" } };
      if (phone === "5511888880000") return { state: "ambiguous" };
      return { state: "not_found" };
    });

    const report = await run(client, true, 50);

    expect(report).toMatchObject({ processed: 4, created: 1, linked: 1, skippedPf: 1, ambiguous: 1, notFound: 1, reused: 0, errors: 0, done: true });
    expect(inserts).toEqual([{ legal_name: "EMPRESA LTDA", trade_name: "FANTASIA", cnpj: "12321030000189", created_by_user_id: "admin-1" }]);
    expect(links).toEqual([{ id: "c1", customer_id: "new-1" }]);
  });

  it("ensaio (apply=false): conta o que faria, sem gravar", async () => {
    const { client, inserts, links } = makeClient([{ id: "c1", phone: "558699783446" }]);
    resolveMock.mockResolvedValue(pj("12.321.030/0001-89"));

    const report = await run(client, false);

    expect(report).toMatchObject({ created: 1, linked: 1 });
    expect(inserts).toEqual([]);
    expect(links).toEqual([]);
  });

  it("empresa com o CNPJ já existe: reusa (não cria) e vincula", async () => {
    const { client, inserts, links } = makeClient([{ id: "c1", phone: "558699783446" }], { "12321030000189": "existe-1" });
    resolveMock.mockResolvedValue(pj("12.321.030/0001-89"));

    const report = await run(client, true);

    expect(report).toMatchObject({ created: 0, reused: 1, linked: 1 });
    expect(inserts).toEqual([]);
    expect(links).toEqual([{ id: "c1", customer_id: "existe-1" }]);
  });

  it("fonte indisponível conta como erro, não como 'sem cadastro'", async () => {
    const { client } = makeClient([{ id: "c1", phone: "558699783446" }]);
    resolveMock.mockResolvedValue({ state: "unavailable" });

    expect((await run(client, true)).errors).toBe(1);
  });

  it("cursor/done: veio uma leva cheia + 1, então não terminou e o cursor é o último processado", async () => {
    const contacts = [
      { id: "c1", phone: "5511001" },
      { id: "c2", phone: "5511002" },
      { id: "c3", phone: "5511003" },
    ];
    const { client } = makeClient(contacts);
    resolveMock.mockResolvedValue({ state: "not_found" });

    const report = await run(client, true, 2);

    expect(report.processed).toBe(2);
    expect(report.done).toBe(false);
    expect(report.cursor).toBe("c2");
  });
});
