// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { integrationMock, statusMock } = vi.hoisted(() => ({
  integrationMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("@/features/chat/lib/connection/integration", () => ({ getUazapiIntegration: integrationMock }));
vi.mock("@/features/chat/lib/connection/uazapi", () => ({ getUazapiStatus: statusMock }));

import { PROVIDER_UNREACHABLE, checkWhatsappConnection } from "@/features/connection/server/connection-monitor";

const INTEGRATION = { id: "integ-1", apiUrl: "https://uazapi.exemplo", token: "segredo", phone_number: "5511999990000" };

/**
 * Supabase falso: `from(tabela)` grava a tabela pedida; a leitura do último
 * estado devolve `last`, e o insert é capturado.
 */
function fakeSupabase(last: { state: string } | null, opts: { readError?: boolean; insertError?: boolean } = {}) {
  const tables: string[] = [];
  const inserted: unknown[] = [];
  const reader = {
    select: () => reader,
    eq: () => reader,
    order: () => reader,
    limit: () => reader,
    maybeSingle: async () =>
      opts.readError ? { data: null, error: { code: "x", message: "falhou" } } : { data: last, error: null },
  };
  const supabase = {
    from: (table: string) => {
      tables.push(table);
      return {
        ...reader,
        insert: async (row: unknown) => {
          inserted.push(row);
          return { error: opts.insertError ? { code: "y", message: "falhou" } : null };
        },
      };
    },
  };
  return { supabase: supabase as never, tables, inserted };
}

beforeEach(() => {
  integrationMock.mockReset();
  statusMock.mockReset();
  integrationMock.mockResolvedValue(INTEGRATION);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("checkWhatsappConnection", () => {
  it("grava a 1ª leitura como ponto de partida", async () => {
    statusMock.mockResolvedValue({ connected: true, state: "open", owner: null, reason: null });
    const db = fakeSupabase(null);

    expect(await checkWhatsappConnection(db.supabase)).toEqual({ status: "changed", from: null, state: "open" });
    expect(db.inserted).toEqual([{ integration_id: "integ-1", state: "open", reason: null, source: "poll" }]);
  });

  it("estado igual ao último não grava nada", async () => {
    statusMock.mockResolvedValue({ connected: true, state: "open", owner: null, reason: null });
    const db = fakeSupabase({ state: "open" });

    expect(await checkWhatsappConnection(db.supabase)).toEqual({ status: "unchanged", state: "open" });
    expect(db.inserted).toEqual([]);
  });

  it("queda grava 'close' com o motivo que o provedor informar", async () => {
    statusMock.mockResolvedValue({ connected: false, state: "close", owner: null, reason: "logged out" });
    const db = fakeSupabase({ state: "open" });

    expect(await checkWhatsappConnection(db.supabase)).toEqual({ status: "changed", from: "open", state: "close" });
    expect(db.inserted).toEqual([{ integration_id: "integ-1", state: "close", reason: "logged out", source: "poll" }]);
  });

  it("provedor sem resposta vira 'unknown' com motivo fixo — nunca o corpo do erro (pode trazer o token)", async () => {
    statusMock.mockRejectedValue(new Error('uazapi status 500: {"token":"segredo"}'));
    const db = fakeSupabase({ state: "open" });

    await checkWhatsappConnection(db.supabase);

    expect(db.inserted).toEqual([
      { integration_id: "integ-1", state: "unknown", reason: PROVIDER_UNREACHABLE, source: "poll" },
    ]);
    expect(JSON.stringify(db.inserted)).not.toContain("segredo");
  });

  it("voltar a conectar grava 'open' sem motivo", async () => {
    statusMock.mockResolvedValue({ connected: true, state: "open", owner: null, reason: "resto" });
    const db = fakeSupabase({ state: "close" });

    await checkWhatsappConnection(db.supabase);

    expect(db.inserted).toEqual([{ integration_id: "integ-1", state: "open", reason: null, source: "poll" }]);
  });

  it("só toca a tabela do histórico: nunca escreve em chat_integrations", async () => {
    statusMock.mockResolvedValue({ connected: true, state: "open", owner: "5511888880000", reason: null });
    const db = fakeSupabase({ state: "close" });

    await checkWhatsappConnection(db.supabase);

    expect(new Set(db.tables)).toEqual(new Set(["chat_connection_events"]));
  });

  it("sem integração ativa, não consulta o provedor", async () => {
    integrationMock.mockResolvedValue(null);
    const db = fakeSupabase(null);

    expect(await checkWhatsappConnection(db.supabase)).toEqual({ status: "skipped" });
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("falha ao ler o último estado não grava às cegas", async () => {
    statusMock.mockResolvedValue({ connected: false, state: "close", owner: null, reason: null });
    const db = fakeSupabase(null, { readError: true });

    expect(await checkWhatsappConnection(db.supabase)).toEqual({ status: "skipped" });
    expect(db.inserted).toEqual([]);
  });

  it("erro ao ler a integração não lança", async () => {
    integrationMock.mockRejectedValue(new Error("vault"));
    const db = fakeSupabase(null);

    await expect(checkWhatsappConnection(db.supabase)).resolves.toEqual({ status: "skipped" });
  });
});
