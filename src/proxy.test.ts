// @vitest-environment node
import { readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  AUTH_COOKIE: "crm-suporte-session",
  verifySessionToken: verifyMock,
}));

import { config, proxy } from "@/proxy";

// O proxy de ponta a ponta: a recusa por origem vem ANTES de qualquer coisa, e
// só para escrita. As regras da origem, uma a uma, estão em route-guard.test.ts.

const HOST = "crm.exemplo.com";
const ADMIN = { id: "u1", email: "a@x.com", name: "Ana", role: "admin" };

// O pedido tem a forma que o servidor entrega ao proxy: a URL leva o endereço em
// que o Next escuta, e o host público só vem no cabeçalho Host.
const LISTENING = "localhost:3000";

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://${LISTENING}${path}`, {
    method: init.method ?? "POST",
    headers: { host: HOST, cookie: "crm-suporte-session=um-token", ...init.headers },
  });
}

const REFUSED = {
  ok: false,
  error: "cross_origin",
  message: "Pedido recusado: ele não partiu desta aplicação.",
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockResolvedValue(ADMIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy: escrita vinda de outra origem", () => {
  it.each([
    ["/api/app-users", "criar usuário"],
    ["/api/auth/definir-senha", "trocar a senha de quem está logado"],
    ["/api/connection/agent/signing-secret", "trocar a chave de assinatura"],
  ])("POST %s vindo de outro subdomínio (%s): 403, mesmo com a sessão de um administrador", async (path) => {
    const response = await proxy(request(path, { headers: { "sec-fetch-site": "same-site" } }));

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual(REFUSED);
    // A recusa vem antes de qualquer coisa: nem o cookie chega a ser conferido.
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("o mesmo POST da própria tela passa", async () => {
    const response = await proxy(request("/api/app-users", { headers: { "sec-fetch-site": "same-origin" } }));

    expect(response).toBeUndefined();
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it("sem os cabeçalhos do navegador (curl, outro servidor): segue para a checagem de sessão de sempre", async () => {
    verifyMock.mockResolvedValue(null);

    const response = await proxy(request("/api/app-users"));

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  it("navegador sem Sec-Fetch-Site: o Origin de outro host é recusado, e o do próprio host passa", async () => {
    const other = await proxy(request("/api/app-users", { headers: { origin: "https://painel.exemplo.com" } }));
    const own = await proxy(request("/api/app-users", { headers: { origin: `https://${HOST}` } }));

    expect(other?.status).toBe(403);
    expect(own).toBeUndefined();
  });

  it("o endereço em que o servidor escuta não é um host próprio: vale o Host que o navegador mandou", async () => {
    const response = await proxy(request("/api/app-users", { headers: { origin: `http://${LISTENING}` } }));

    expect(response?.status).toBe(403);
  });

  it("o próprio host é o cabeçalho Host do pedido, e também o da URL pública configurada", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://suporte.exemplo.com.br/");
    const behindProxy = { host: "crmsup-web:3000", origin: "https://suporte.exemplo.com.br" };

    expect(await proxy(request("/api/app-users", { headers: behindProxy }))).toBeUndefined();
    expect(
      (await proxy(request("/api/app-users", { headers: { ...behindProxy, origin: "https://outro.exemplo.com.br" } })))
        ?.status
    ).toBe(403);
  });

  it("o X-Forwarded-Host não é um host próprio: só o Host e a URL pública contam", async () => {
    const response = await proxy(
      request("/api/app-users", {
        headers: { "x-forwarded-host": "painel.exemplo.com", origin: "https://painel.exemplo.com" },
      })
    );

    expect(response?.status).toBe(403);
  });

  it("a porta da URL pública conta: outra porta da mesma máquina é outra origem", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "http://localhost:3200");
    const behindProxy = { host: "crmsup-web:3000" };

    expect(
      await proxy(request("/api/app-users", { headers: { ...behindProxy, origin: "http://localhost:3200" } }))
    ).toBeUndefined();
    expect(
      (await proxy(request("/api/app-users", { headers: { ...behindProxy, origin: "http://localhost:3201" } })))?.status
    ).toBe(403);
  });

  it("URL pública mal formada não derruba o proxy: vale só o Host", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "não é url");

    expect(await proxy(request("/api/app-users", { headers: { origin: `https://${HOST}` } }))).toBeUndefined();
    expect((await proxy(request("/api/app-users", { headers: { origin: "https://atacante.test" } })))?.status).toBe(403);
  });

  it("URL pública sem esquema não vira um host próprio vazio: origem sem host segue recusada", async () => {
    // `new URL("localhost:3200")` é uma URL válida, de esquema `localhost:` e sem host.
    vi.stubEnv("APP_PUBLIC_URL", "localhost:3200");

    expect((await proxy(request("/api/app-users", { headers: { origin: "file://" } })))?.status).toBe(403);
    expect(await proxy(request("/api/app-users", { headers: { origin: `https://${HOST}` } }))).toBeUndefined();
  });

  it("leitura de outra origem não é barrada aqui: segue a regra de sessão", async () => {
    const response = await proxy(
      request("/api/contacts", { method: "GET", headers: { "sec-fetch-site": "cross-site" } })
    );

    expect(response).toBeUndefined();
  });

  it("vale para qualquer caminho que o proxy veja, e não só para /api", async () => {
    const page = await proxy(request("/login", { headers: { "sec-fetch-site": "cross-site" } }));
    const encoded = await proxy(request("/%61pi/app-users", { headers: { "sec-fetch-site": "same-site" } }));

    expect(page?.status).toBe(403);
    expect(encoded?.status).toBe(403);
    expect(await encoded?.json()).toEqual(REFUSED);
  });

  // A isenção confia nisto: o `..` chega ao proxy já resolvido, escrito às
  // claras ou codificado. Se o Next deixar de resolver, este teste avisa.
  it.each(["/api/v1/../app-users", "/api/v1/%2e%2e/app-users", "/api/chat/webhook/../../app-users"])(
    "%s não sai de um prefixo isento: o proxy vê /api/app-users",
    async (path) => {
      const response = await proxy(request(path, { headers: { "sec-fetch-site": "same-site" } }));

      expect(response?.status).toBe(403);
    }
  );

  it.each([
    ["/api/chat/webhook/uazapi", "a uazapi"],
    ["/api/v1/tickets", "um integrador"],
  ])("%s segue aberto a quem chama de fora, sem sessão (%s tem credencial própria)", async (path) => {
    verifyMock.mockResolvedValue(null);

    const response = await proxy(
      request(path, { headers: { "sec-fetch-site": "cross-site", origin: "https://integrador.test", cookie: "" } })
    );

    expect(response).toBeUndefined();
  });
});

// A trava só age onde o proxy roda. Estes dois testes seguram as duas premissas
// disso: o proxy roda em toda rota de /api, e não há rota fora de lá.
describe("proxy: alcance da trava de origem", () => {
  it("o proxy roda em toda rota de /api", () => {
    expect(config.matcher).toContain("/api/:path*");
  });

  it("todo route handler mora em src/app/api", () => {
    const appDir = path.join(process.cwd(), "src/app");
    const handlers = readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((file) => /^route\.(ts|tsx|js|jsx|mjs)$/.test(path.basename(file)))
      .map((file) => file.split(path.sep).join("/"));

    expect(handlers.length).toBeGreaterThan(50);
    expect(handlers.filter((file) => !file.startsWith("api/"))).toEqual([]);
  });
});
