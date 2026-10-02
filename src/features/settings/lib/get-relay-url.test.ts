// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { hasEnvMock, clientMock, readMock } = vi.hoisted(() => ({
  hasEnvMock: vi.fn(),
  clientMock: vi.fn(),
  readMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerEnv: hasEnvMock,
  createSupabaseServerClient: clientMock,
}));

import { UnsafeUrlError } from "@/features/chat/lib/connection/ssrf-guard";
import { assertRelayUrl, getRelayConfig, readRelayUrl } from "@/features/settings/lib/get-relay-url";

const URL_OK = "https://agente.exemplo.com/webhook";

// Um Supabase que só responde a leitura de app_settings, e grava o filtro.
const filters: unknown[][] = [];
const supabase = {
  from: (table: string) => ({
    select: (columns: string) => ({
      eq: (...args: unknown[]) => {
        filters.push([table, columns, ...args]);
        return { maybeSingle: readMock };
      },
    }),
  }),
} as unknown as Parameters<typeof readRelayUrl>[0];

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  hasEnvMock.mockReturnValue(true);
  clientMock.mockReturnValue(supabase);
  readMock.mockResolvedValue({ data: { value: { relay_url: URL_OK } }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readRelayUrl", () => {
  it("lê a URL salva em app_settings.automation", async () => {
    await expect(readRelayUrl(supabase)).resolves.toBe(URL_OK);

    expect(filters).toEqual([["app_settings", "value", "key", "automation"]]);
  });

  it.each([
    ["linha ausente", null],
    ["URL vazia", { value: { relay_url: "" } }],
    ["só espaços", { value: { relay_url: "  " } }],
    ["sem a chave", { value: {} }],
    ["valor nulo", { value: null }],
    ["valor que não é texto", { value: { relay_url: 42 } }],
    ["valor que é lista", { value: [URL_OK] }],
    ["valor que é texto solto", { value: URL_OK }],
  ])("%s é `não configurada`", async (_label, data) => {
    readMock.mockResolvedValue({ data, error: null });

    await expect(readRelayUrl(supabase)).resolves.toBeNull();
  });

  it("tira o espaço em volta", async () => {
    readMock.mockResolvedValue({ data: { value: { relay_url: `  ${URL_OK}\n` } }, error: null });

    await expect(readRelayUrl(supabase)).resolves.toBe(URL_OK);
  });

  it("LANÇA quando a leitura falha: não é o mesmo que `não configurada`", async () => {
    readMock.mockResolvedValue({ data: null, error: { message: "timeout" } });

    await expect(readRelayUrl(supabase)).rejects.toThrow("app_settings: timeout");
  });
});

describe("assertRelayUrl", () => {
  it("devolve a URL que passou pela guarda", () => {
    expect(assertRelayUrl(`${URL_OK}?fluxo=1`).href).toBe(`${URL_OK}?fluxo=1`);
  });

  it.each([
    ["rede interna", "https://10.0.0.5/x", "A URL aponta para um host de rede interna (bloqueado)."],
    ["esquema que não é http", "file:///etc/passwd", "A URL deve usar http ou https."],
    ["usuário e senha", "https://u:s@agente.exemplo.com/x", "A URL não pode levar usuário e senha."],
    ["só usuário", "https://u@agente.exemplo.com/x", "A URL não pode levar usuário e senha."],
    ["só senha", "https://:s@agente.exemplo.com/x", "A URL não pode levar usuário e senha."],
  ])("recusa %s com UnsafeUrlError", (_label, url, message) => {
    expect(() => assertRelayUrl(url)).toThrow(UnsafeUrlError);
    expect(() => assertRelayUrl(url)).toThrow(message);
  });

  it("em produção exige HTTPS, e rede interna segue recusada com HTTPS", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => assertRelayUrl("http://agente.exemplo.com/x")).toThrow("Em produção a URL deve usar HTTPS.");
    expect(() => assertRelayUrl("https://10.0.0.5/x")).toThrow("A URL aponta para um host de rede interna (bloqueado).");
    expect(() => assertRelayUrl("https://u:s@agente.exemplo.com/x")).toThrow("A URL não pode levar usuário e senha.");
    expect(assertRelayUrl(URL_OK).protocol).toBe("https:");
  });
});

describe("getRelayConfig", () => {
  // Não há reserva em variável de ambiente: a antiga fica definida em TODOS os
  // casos, e em nenhum ela aparece (nem sem URL, nem com a leitura falhando,
  // nem sem Supabase).
  beforeEach(() => {
    vi.stubEnv("N8N_WEBHOOK_URL", "https://n8n.exemplo.com/webhook/antigo");
  });

  it("URL salva que o envio aceita: `active`", async () => {
    await expect(getRelayConfig()).resolves.toEqual({ configuredUrl: URL_OK, state: "active", reason: null });
  });

  it("sem URL: `none`, e N8N_WEBHOOK_URL é ignorada", async () => {
    readMock.mockResolvedValue({ data: null, error: null });

    await expect(getRelayConfig()).resolves.toEqual({ configuredUrl: null, state: "none", reason: null });
  });

  it.each([
    ["rede interna", "https://10.0.0.5/hook", "A URL aponta para um host de rede interna (bloqueado)."],
    ["credencial embutida", "https://u:s@agente.exemplo.com/x", "A URL não pode levar usuário e senha."],
    ["texto que não é URL", "agente", "URL inválida."],
  ])("URL salva que o envio recusa (%s): `refused`, com o motivo e a URL no campo", async (_label, url, reason) => {
    readMock.mockResolvedValue({ data: { value: { relay_url: url } }, error: null });

    await expect(getRelayConfig()).resolves.toEqual({ configuredUrl: url, state: "refused", reason });
  });

  it("URL http salva antes, em produção: `refused` (o envio a recusaria a cada mensagem)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    readMock.mockResolvedValue({ data: { value: { relay_url: "http://agente.exemplo.com/x" } }, error: null });

    await expect(getRelayConfig()).resolves.toEqual({
      configuredUrl: "http://agente.exemplo.com/x",
      state: "refused",
      reason: "Em produção a URL deve usar HTTPS.",
    });
  });

  it("leitura que falha não derruba a tela, e não vira `sem URL`: `unreadable`, com o erro no log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    readMock.mockResolvedValue({ data: null, error: { message: "timeout" } });

    await expect(getRelayConfig()).resolves.toEqual({ configuredUrl: null, state: "unreadable", reason: null });
    expect(error).toHaveBeenCalledWith("getRelayConfig failed", expect.objectContaining({ message: "app_settings: timeout" }));
    error.mockRestore();
  });

  it("sem Supabase configurado: `none`, sem criar client", async () => {
    hasEnvMock.mockReturnValue(false);

    await expect(getRelayConfig()).resolves.toEqual({ configuredUrl: null, state: "none", reason: null });
    expect(clientMock).not.toHaveBeenCalled();
  });
});
