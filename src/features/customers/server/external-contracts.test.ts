// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerContract } from "@/features/customer-source/types";

const { contextMock } = vi.hoisted(() => ({ contextMock: vi.fn() }));
vi.mock("@/features/customer-source/get-customer-context", () => ({
  getCustomerContext: contextMock,
}));

import {
  reconcileExternalContracts,
  storeExternalContracts,
  syncExternalContracts,
} from "@/features/customers/server/external-contracts";

type Customer = { id: string; cnpj: string | null };

/** Mock encadeável: lista de customers (thenable) e captura das escritas no espelho. */
function makeClient(customers: Customer[] = []) {
  const upserts: { rows: Record<string, unknown>[]; opts: unknown }[] = [];
  const deletes: { filters: [string, string, unknown][] }[] = [];

  const listing = {
    select: () => listing,
    not: () => listing,
    is: () => listing,
    order: () => listing,
    gt: () => listing,
    limit: () => listing,
    then: (resolve: (v: { data: Customer[]; error: null }) => void) =>
      resolve({ data: customers, error: null }),
  };

  const client = {
    from(table: string) {
      if (table === "customers") return listing;
      if (table === "external_contracts") {
        return {
          upsert: (rows: Record<string, unknown>[], opts: unknown) => {
            upserts.push({ rows, opts });
            return Promise.resolve({ error: null });
          },
          delete: () => {
            const record = { filters: [] as [string, string, unknown][] };
            const builder = {
              eq: (col: string, val: unknown) => {
                record.filters.push(["eq", col, val]);
                return builder;
              },
              lt: (col: string, val: unknown) => {
                record.filters.push(["lt", col, val]);
                deletes.push(record);
                return Promise.resolve({ error: null });
              },
              then: (resolve: (v: { error: null }) => void) => {
                deletes.push(record);
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };

  return { client: client as never, upserts, deletes };
}

const contract = (overrides: Partial<CustomerContract>): CustomerContract => ({
  id: 1,
  numero: "CT-1",
  modalidade: "Mensal",
  vigencia: null,
  dataInicio: "2026-01-15",
  dataFim: null,
  vencimentoDia: 10,
  status: "assinado",
  statusVigencia: "ativo",
  dataAtivacao: "2026-01-15",
  ...overrides,
});

const okContext = (contratos: CustomerContract[]) => ({
  state: "ok" as const,
  context: {
    externalId: "33",
    tipoPessoa: "PJ" as const,
    documento: "12321030000189",
    razaoSocial: "EMPRESA",
    nomeFantasia: null,
    status: "ativo",
    emailPrincipal: null,
    emailFinanceiro: null,
    telefonePrincipal: null,
    telefoneSecundario: null,
    contratos,
    titulosEmAberto: [],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("storeExternalContracts", () => {
  it("faz upsert dos contratos e conta os ativos", async () => {
    const { client, upserts, deletes } = makeClient();
    const result = await storeExternalContracts(client, "cust-1", [
      contract({ id: 1, statusVigencia: "ativo" }),
      contract({ id: 2, statusVigencia: "encerrado" }),
    ]);

    expect(result).toEqual({ upserted: 2, active: 1 });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].opts).toEqual({ onConflict: "customer_id,provider,external_id" });
    expect(upserts[0].rows.map((r) => r.external_id)).toEqual(["1", "2"]);
    expect(upserts[0].rows[0]).toMatchObject({ customer_id: "cust-1", provider: "tcbx" });
    // Poda os que não vieram nesta leva (synced_at anterior).
    expect(deletes).toHaveLength(1);
  });

  it("descarta data não-ISO e dia de vencimento fora de 1..31", async () => {
    const { client, upserts } = makeClient();
    await storeExternalContracts(client, "cust-1", [
      contract({ dataInicio: "15/01/2026", vencimentoDia: 45 }),
    ]);
    expect(upserts[0].rows[0]).toMatchObject({ data_inicio: null, vencimento_dia: null });
  });

  it("sem contratos: não faz upsert, mas ainda poda o que havia", async () => {
    const { client, upserts, deletes } = makeClient();
    const result = await storeExternalContracts(client, "cust-1", []);
    expect(result).toEqual({ upserted: 0, active: 0 });
    expect(upserts).toHaveLength(0);
    expect(deletes).toHaveLength(1);
  });
});

describe("syncExternalContracts", () => {
  it("sem CNPJ não consulta a fonte", async () => {
    const { client } = makeClient();
    const result = await syncExternalContracts(client, { customerId: "c1", cnpj: null });
    expect(result).toEqual({ state: "skipped" });
    expect(contextMock).not.toHaveBeenCalled();
  });

  it.each(["not_configured", "unavailable", "ambiguous"] as const)(
    "estado %s passa adiante sem tocar o espelho",
    async (state) => {
      contextMock.mockResolvedValue({ state });
      const { client, upserts, deletes } = makeClient();
      const result = await syncExternalContracts(client, { customerId: "c1", cnpj: "123" });
      expect(result).toEqual({ state });
      expect(upserts).toHaveLength(0);
      expect(deletes).toHaveLength(0);
    }
  );

  it("not_found esvazia o espelho da empresa", async () => {
    contextMock.mockResolvedValue({ state: "not_found" });
    const { client, deletes } = makeClient();
    const result = await syncExternalContracts(client, { customerId: "c1", cnpj: "123" });
    expect(result).toEqual({ state: "not_found" });
    // delete por customer_id + provider, sem lt (limpeza total).
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toEqual([
      ["eq", "customer_id", "c1"],
      ["eq", "provider", "tcbx"],
    ]);
  });

  it("ok grava os contratos da fonte", async () => {
    contextMock.mockResolvedValue(okContext([contract({ id: 1, statusVigencia: "ativo" })]));
    const { client, upserts } = makeClient();
    const result = await syncExternalContracts(client, { customerId: "c1", cnpj: "123" });
    expect(result).toEqual({ state: "ok", upserted: 1, active: 1 });
    expect(upserts).toHaveLength(1);
  });
});

describe("reconcileExternalContracts", () => {
  it("sincroniza a leva e termina (done) quando cabe no limite", async () => {
    contextMock.mockResolvedValue(okContext([contract({ id: 1 })]));
    const { client } = makeClient([
      { id: "a", cnpj: "111" },
      { id: "b", cnpj: "222" },
    ]);

    const report = await reconcileExternalContracts(client, { limit: 50 });

    expect(report).toMatchObject({
      processed: 2,
      ok: 2,
      contractsUpserted: 2,
      done: true,
      cursor: null,
      notConfigured: false,
    });
  });

  it("avança por cursor quando há mais que o limite", async () => {
    contextMock.mockResolvedValue(okContext([]));
    const { client } = makeClient([
      { id: "a", cnpj: "111" },
      { id: "b", cnpj: "222" },
    ]);

    const report = await reconcileExternalContracts(client, { limit: 1 });

    expect(report.processed).toBe(1);
    expect(report.done).toBe(false);
    expect(report.cursor).toBe("a");
  });

  it("aborta a leva quando a fonte está desligada (not_configured)", async () => {
    contextMock.mockResolvedValue({ state: "not_configured" });
    const { client } = makeClient([{ id: "a", cnpj: "111" }]);

    const report = await reconcileExternalContracts(client, { limit: 50 });

    expect(report.notConfigured).toBe(true);
    expect(report.processed).toBe(0);
    expect(report.done).toBe(true);
  });
});
