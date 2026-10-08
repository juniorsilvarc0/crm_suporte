// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));
vi.mock("@/features/customer-source/resolve-by-phone", () => ({ resolveCustomerByPhone: resolveMock }));

import { enrichContactFromSource } from "@/features/customers/server/enrich-contact";

const okContext = (documento: string, contratos: unknown[] = []) => ({
  state: "ok" as const,
  context: {
    externalId: "1",
    tipoPessoa: "PJ" as const,
    documento,
    razaoSocial: "EMPRESA LTDA",
    nomeFantasia: "FANTASIA",
    status: "ativo",
    emailPrincipal: null,
    emailFinanceiro: null,
    telefonePrincipal: null,
    telefoneSecundario: null,
    contratos,
    titulosEmAberto: [],
  },
});

function makeClient(opts: { existing?: string | null; insertError?: boolean } = {}) {
  const existing = opts.existing ?? null;
  const inserts: Record<string, unknown>[] = [];
  const links: { id: string; customer_id: string | null }[] = [];
  const upserts: unknown[] = [];
  let newId = 0;

  const client = {
    from(table: string) {
      if (table === "customers") {
        const customers = {
          select: () => customers,
          eq: () => customers,
          is: () => customers,
          maybeSingle: () => Promise.resolve({ data: existing ? { id: existing } : null, error: null }),
          insert: (values: Record<string, unknown>) => {
            inserts.push(values);
            return {
              select: () => ({
                single: () =>
                  opts.insertError
                    ? Promise.resolve({ data: null, error: { code: "23505", message: "dup" } })
                    : Promise.resolve({ data: { id: `new-${(newId += 1)}` }, error: null }),
              }),
            };
          },
        };
        return customers;
      }
      if (table === "contacts") {
        return {
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
        const del = { eq: () => del, lt: () => Promise.resolve({ error: null }) };
        return {
          upsert: (rows: unknown) => {
            upserts.push(rows);
            return Promise.resolve({ error: null });
          },
          delete: () => del,
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };

  return { client: client as never, inserts, links, upserts };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("enrichContactFromSource", () => {
  it.each(["not_found", "ambiguous", "unavailable", "not_configured"] as const)(
    "estado %s não cria nem vincula empresa",
    async (state) => {
      resolveMock.mockResolvedValue({ state });
      const { client, inserts, links } = makeClient();
      const result = await enrichContactFromSource(client, { contactId: "c1", phone: "5586..." });
      expect(result).toEqual({ state });
      expect(inserts).toEqual([]);
      expect(links).toEqual([]);
    }
  );

  it("pessoa física (CPF) não vira empresa", async () => {
    resolveMock.mockResolvedValue(okContext("123.456.789-00"));
    const { client, inserts, links } = makeClient();
    const result = await enrichContactFromSource(client, { contactId: "c1", phone: "5586..." });
    expect(result).toEqual({ state: "skipped_pf" });
    expect(inserts).toEqual([]);
    expect(links).toEqual([]);
  });

  it("PJ nova: cria empresa, vincula o contato e espelha os contratos", async () => {
    resolveMock.mockResolvedValue(
      okContext("12.321.030/0001-89", [{ id: 1, numero: "CT-1", statusVigencia: "ativo" }])
    );
    const { client, inserts, links, upserts } = makeClient();
    const result = await enrichContactFromSource(client, { contactId: "c1", phone: "5586..." });

    expect(result).toEqual({ state: "linked", created: true, customerId: "new-1" });
    expect(inserts[0]).toMatchObject({ cnpj: "12321030000189", legal_name: "EMPRESA LTDA" });
    // Vincula só o contato sem empresa (o builder usa .is('customer_id', null)).
    expect(links).toEqual([{ id: "c1", customer_id: "new-1" }]);
    expect(upserts).toHaveLength(1);
  });

  it("PJ já cadastrada: reusa a empresa (não cria) e vincula", async () => {
    resolveMock.mockResolvedValue(okContext("12.321.030/0001-89"));
    const { client, inserts, links } = makeClient({ existing: "existe-1" });
    const result = await enrichContactFromSource(client, { contactId: "c1", phone: "5586..." });

    expect(result).toEqual({ state: "linked", created: false, customerId: "existe-1" });
    expect(inserts).toEqual([]);
    expect(links).toEqual([{ id: "c1", customer_id: "existe-1" }]);
  });

  it("erro ao criar empresa (corrida pelo CNPJ) devolve error", async () => {
    resolveMock.mockResolvedValue(okContext("12.321.030/0001-89"));
    const { client } = makeClient({ insertError: true });
    const result = await enrichContactFromSource(client, { contactId: "c1", phone: "5586..." });
    expect(result).toEqual({ state: "error" });
  });
});
