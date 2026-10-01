// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { putMediaMock } = vi.hoisted(() => ({ putMediaMock: vi.fn() }));
vi.mock("@/lib/storage/put-media", () => ({ putMedia: putMediaMock }));

import { persistInboundMedia } from "@/features/chat/lib/media/persist-inbound";

// O download da mídia que chega no webhook: a URL vem do payload do provedor, o
// caminho menos confiável que passa pela guarda. Sem rede: o `fetch` é de mentira.

const supabase = {} as Parameters<typeof persistInboundMedia>[0];
const INSTANCE = "https://inst.uazapi.test";
const TOKEN = "token-da-instancia";
const stored = { bucket: "chat-media", key: "chat/a.jpg", thumbKey: null, contentType: "image/jpeg", width: 1, height: 1 };

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

const sentInit = () => fetchMock.mock.calls[0][1] as RequestInit;

beforeEach(() => {
  vi.clearAllMocks();
  putMediaMock.mockResolvedValue(stored);
  fetchMock = vi.fn(async () => new Response("bytes", { status: 200, headers: { "content-type": "image/png" } }));
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  warn.mockRestore();
});

describe("persistInboundMedia", () => {
  it("baixa a mídia pública e a guarda, com o tipo informado", async () => {
    const result = await persistInboundMedia(supabase, "chat", "https://mmg.whatsapp.net/v/arquivo.enc?oh=1", "image/jpeg");

    expect(result).toBe(stored);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // O que é buscado é o objeto que passou pela guarda.
    expect(fetchMock.mock.calls[0][0]).toBeInstanceOf(URL);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://mmg.whatsapp.net/v/arquivo.enc?oh=1");
    expect(putMediaMock).toHaveBeenCalledWith({
      supabase,
      folder: "chat",
      body: Buffer.from("bytes"),
      mime: "image/jpeg",
    });
  });

  it("não segue redirecionamento, não usa cache e tem prazo de 20 s", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await persistInboundMedia(supabase, "chat", "https://mmg.whatsapp.net/v/arquivo.enc", "image/jpeg");

    // A guarda só confere a URL inicial: seguir um 3xx levaria o download a rede interna.
    expect(sentInit()).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(sentInit().signal).toBe(timeout.mock.results[0].value);
    timeout.mockRestore();
  });

  it.each([
    ["IP privado", "https://10.0.0.5/arquivo"],
    ["metadata da cloud", "https://169.254.169.254/latest/meta-data"],
    ["nome interno", "https://host.docker.internal/arquivo"],
    ["IPv4 mapeado em IPv6", "https://[::ffff:10.0.0.5]/arquivo"],
    ["esquema que não é http", "file:///etc/passwd"],
    ["texto que não é URL", "não é url"],
  ])("URL que a guarda recusa (%s): nenhum pedido sai, e a mídia fica sem cópia", async (_label, url) => {
    const result = await persistInboundMedia(supabase, "chat", url, "image/jpeg", { token: TOKEN, tokenOrigin: INSTANCE });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(putMediaMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("em produção, serviço da rede do Docker é recusado", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await persistInboundMedia(supabase, "chat", "https://storage:5000/arquivo", "image/jpeg");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("o token da instância só acompanha o pedido ao host da própria instância", () => {
    const withToken = (url: string, opts: { tokenOrigin?: string } = { tokenOrigin: INSTANCE }) =>
      persistInboundMedia(supabase, "chat", url, "image/jpeg", { token: TOKEN, ...opts });

    it("mesma origem: o token vai", async () => {
      await withToken(`${INSTANCE}/files/abc.jpg`);

      expect(sentInit().headers).toEqual({ token: TOKEN });
    });

    it.each([
      ["outro host", "https://mmg.whatsapp.net/v/arquivo.enc"],
      ["mesmo host em outra porta", "https://inst.uazapi.test:8443/files/abc.jpg"],
      ["mesmo host em http", "http://inst.uazapi.test/files/abc.jpg"],
      ["subdomínio da instância", "https://cdn.inst.uazapi.test/files/abc.jpg"],
      ["host que só começa igual", "https://inst.uazapi.test.evil.example/files/abc.jpg"],
    ])("%s: o token NÃO vai", async (_label, url) => {
      await withToken(url);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentInit().headers).toBeUndefined();
      expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain(TOKEN);
    });

    it.each([
      ["sem a origem da instância", {}],
      ["origem da instância que não é URL", { tokenOrigin: "não é url" }],
    ])("%s: o token NÃO vai", async (_label, opts) => {
      await withToken(`${INSTANCE}/files/abc.jpg`, opts);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentInit().headers).toBeUndefined();
    });

    it("sem token, nenhum cabeçalho", async () => {
      await persistInboundMedia(supabase, "chat", `${INSTANCE}/files/abc.jpg`, "image/jpeg", { tokenOrigin: INSTANCE });

      expect(sentInit().headers).toBeUndefined();
    });
  });

  it("sem tipo informado, vale o da resposta; sem nenhum, octet-stream", async () => {
    await persistInboundMedia(supabase, "chat", "https://mmg.whatsapp.net/a", null);
    expect(putMediaMock.mock.calls[0][0].mime).toBe("image/png");

    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    await persistInboundMedia(supabase, "chat", "https://mmg.whatsapp.net/b", null);
    expect(putMediaMock.mock.calls[1][0].mime).toBe("application/octet-stream");
    expect(putMediaMock.mock.calls[1][0].body).toEqual(Buffer.from([1, 2, 3]));
  });

  it.each([
    ["resposta que não é 2xx", () => Promise.resolve(new Response("não", { status: 404 }))],
    ["redirecionamento recusado pelo fetch", () => Promise.reject(new TypeError("fetch failed", { cause: new Error("unexpected redirect") }))],
    ["prazo estourado", () => Promise.reject(new DOMException("timeout", "TimeoutError"))],
  ])("%s: devolve null sem gravar nada, e não lança", async (_label, respond) => {
    fetchMock.mockImplementation(respond);

    await expect(persistInboundMedia(supabase, "chat", "https://mmg.whatsapp.net/a", "image/jpeg")).resolves.toBeNull();
    expect(putMediaMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[persistInboundMedia] mantendo URL original:", expect.anything());
  });

  it("falha ao guardar não lança: a mensagem fica com a URL original", async () => {
    putMediaMock.mockRejectedValue(new Error("storage fora"));

    await expect(persistInboundMedia(supabase, "chat", "https://mmg.whatsapp.net/a", "image/jpeg")).resolves.toBeNull();
  });
});
