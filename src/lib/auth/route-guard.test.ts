import { describe, it, expect } from "vitest";

import { decideRouteAccess, isCrossOriginWrite, isPublicApiRoute } from "@/lib/auth/route-guard";

describe("decideRouteAccess", () => {
  describe("rotas internas de /api", () => {
    it("bloqueia com 401 quando não há sessão", () => {
      expect(decideRouteAccess("/api/contacts", false)).toEqual({
        type: "unauthorized",
      });
      expect(decideRouteAccess("/api/tags", false)).toEqual({
        type: "unauthorized",
      });
      expect(decideRouteAccess("/api/chat/conversations/1/send", false)).toEqual(
        { type: "unauthorized" }
      );
    });

    it("libera quando há sessão válida", () => {
      expect(decideRouteAccess("/api/contacts", true)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/chat/conversations", true)).toEqual({
        type: "allow",
      });
    });
  });

  describe("rotas de API públicas (autenticação própria)", () => {
    it("libera o webhook da uazapi mesmo sem sessão", () => {
      expect(decideRouteAccess("/api/chat/webhook/uazapi", false)).toEqual({
        type: "allow",
      });
    });

    it("libera login e logout mesmo sem sessão", () => {
      expect(decideRouteAccess("/api/auth/login", false)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/auth/logout", false)).toEqual({
        type: "allow",
      });
    });

    it("deixa a API v1 com o withApi (token com escopo), sem pedir sessão", () => {
      expect(decideRouteAccess("/api/v1/me", false)).toEqual({ type: "allow" });
      expect(decideRouteAccess("/api/v1/tickets/1", false)).toEqual({ type: "allow" });
    });

    it("não confunde /api/v1 com um prefixo parecido", () => {
      expect(decideRouteAccess("/api/v10/me", false)).toEqual({ type: "unauthorized" });
      expect(decideRouteAccess("/api/v1", false)).toEqual({ type: "unauthorized" });
    });

    it("não libera mais as rotas que saíram (Meta, n8n, integração antiga)", () => {
      // Prefixo público que sobrasse sem rota viraria porta aberta para a
      // próxima rota criada ali.
      expect(decideRouteAccess("/api/internal/meta/dispatch", false)).toEqual({
        type: "unauthorized",
      });
      expect(decideRouteAccess("/api/meta/conversions/123/retry", false)).toEqual({
        type: "unauthorized",
      });
      expect(decideRouteAccess("/api/webhooks/n8n/lead", false)).toEqual({
        type: "unauthorized",
      });
      expect(decideRouteAccess("/api/integracao/leads", false)).toEqual({
        type: "unauthorized",
      });
    });
  });

  describe("páginas protegidas", () => {
    it("redireciona para o login sem sessão, preservando o destino", () => {
      expect(decideRouteAccess("/app/chat", false)).toEqual({
        type: "redirect-login",
        redirectTo: "/app/chat",
      });
      expect(decideRouteAccess("/admin", false)).toEqual({
        type: "redirect-login",
        redirectTo: "/admin",
      });
    });

    it("libera com sessão válida", () => {
      expect(decideRouteAccess("/app/chat", true)).toEqual({ type: "allow" });
    });
  });

  describe("página de login", () => {
    it("redireciona para /app se já autenticado", () => {
      expect(decideRouteAccess("/login", true)).toEqual({ type: "redirect-app" });
    });

    it("libera o login sem sessão", () => {
      expect(decideRouteAccess("/login", false)).toEqual({ type: "allow" });
    });
  });

  describe("páginas administrativas", () => {
    const adminPages = ["/app/conexao", "/app/equipe", "/app/configuracoes"];

    it.each(adminPages)("libera %s para admin", (page) => {
      expect(decideRouteAccess(page, true, "admin")).toEqual({ type: "allow" });
    });

    it.each(adminPages)("redireciona %s para /app quando é member", (page) => {
      expect(decideRouteAccess(page, true, "member")).toEqual({ type: "redirect-app" });
    });

    it("também bloqueia uma sub-rota administrativa para member", () => {
      expect(decideRouteAccess("/app/equipe/qualquer", true, "member")).toEqual({
        type: "redirect-app",
      });
    });

    it("não confunde uma página não-administrativa", () => {
      expect(decideRouteAccess("/app/chat", true, "member")).toEqual({ type: "allow" });
    });

    it("sem sessão em página admin vai para login (não depende do papel)", () => {
      expect(decideRouteAccess("/app/equipe", false, null)).toEqual({
        type: "redirect-login",
        redirectTo: "/app/equipe",
      });
    });
  });

  describe("isPublicApiRoute", () => {
    it("reconhece rotas públicas", () => {
      expect(isPublicApiRoute("/api/chat/webhook/uazapi")).toBe(true);
      expect(isPublicApiRoute("/api/auth/login")).toBe(true);
      expect(isPublicApiRoute("/api/v1/health")).toBe(true);
    });

    it("reconhece rotas internas como não-públicas", () => {
      expect(isPublicApiRoute("/api/contacts")).toBe(false);
      expect(isPublicApiRoute("/api/tags")).toBe(false);
      expect(isPublicApiRoute("/api/internal/meta/dispatch")).toBe(false);
      expect(isPublicApiRoute("/api/integracao/leads")).toBe(false);
    });
  });
});

describe("isCrossOriginWrite", () => {
  const HOST = "crm.exemplo.com";
  const check = (
    pathname: string,
    request: Partial<Parameters<typeof isCrossOriginWrite>[1]> = {}
  ) =>
    isCrossOriginWrite(pathname, {
      method: "POST",
      secFetchSite: null,
      origin: null,
      ownHosts: [HOST],
      ...request,
    });

  describe("quando o navegador diz de onde o pedido partiu (Sec-Fetch-Site)", () => {
    it.each([
      ["same-site", "outro subdomínio do mesmo site: o cookie Lax vai junto"],
      ["cross-site", "outro site"],
      ["qualquer-coisa", "valor desconhecido não é a própria origem"],
      // O navegador manda em minúsculas e sem espaço. Fora disso, recusa.
      ["Same-Origin", "o valor certo em outra caixa"],
      [" same-origin ", "o valor certo com espaço em volta"],
      ["same-origin, same-origin", "o cabeçalho repetido"],
    ])("recusa `%s` (%s)", (secFetchSite) => {
      expect(check("/api/app-users", { secFetchSite })).toBe(true);
    });

    it.each([
      ["same-origin", "a própria tela"],
      ["none", "ação direta do usuário"],
    ])("deixa passar `%s` (%s)", (secFetchSite) => {
      expect(check("/api/app-users", { secFetchSite })).toBe(false);
    });

    it("vale o que o navegador diz, e não o Origin: `same-origin` passa mesmo com um Origin estranho", () => {
      expect(check("/api/app-users", { secFetchSite: "same-origin", origin: "https://outro.exemplo.com" })).toBe(false);
      expect(check("/api/app-users", { secFetchSite: "same-site", origin: `https://${HOST}` })).toBe(true);
    });
  });

  describe("sem Sec-Fetch-Site (navegador antigo, ou HTTP fora de localhost): vale o Origin", () => {
    it.each([
      ["a própria origem", `https://${HOST}`],
      ["a própria origem em outra caixa", "https://CRM.Exemplo.com"],
      // Limite conhecido: só o host é comparado. A troca de esquema fica com o HSTS.
      ["a própria origem por http", `http://${HOST}`],
    ])("deixa passar %s", (_label, origin) => {
      expect(check("/api/app-users", { origin })).toBe(false);
    });

    it.each([
      ["outro subdomínio", "https://painel.exemplo.com"],
      ["um subdomínio do próprio host", `https://api.${HOST}`],
      ["o domínio pai", "https://exemplo.com"],
      ["um host que só termina igual", "https://evilcrm.exemplo.com"],
      ["outro site", "https://atacante.test"],
      ["a mesma máquina em outra porta", `https://${HOST}:8443`],
      ["Origin `null` (iframe isolado)", "null"],
      ["texto que não é uma origem", "não é url"],
      ["só espaços", "  "],
    ])("recusa %s", (_label, origin) => {
      expect(check("/api/app-users", { origin })).toBe(true);
    });

    it("a porta faz parte do host: localhost:3000 não é localhost:3001", () => {
      const ownHosts = ["localhost:3000"];

      expect(check("/api/app-users", { origin: "http://localhost:3000", ownHosts })).toBe(false);
      expect(check("/api/app-users", { origin: "http://localhost:3001", ownHosts })).toBe(true);
    });

    it("o próprio host vale em qualquer caixa (o Host chega como o cliente o escreveu)", () => {
      expect(check("/api/app-users", { origin: `https://${HOST}`, ownHosts: ["CRM.Exemplo.com"] })).toBe(false);
    });

    it("a URL pública do app também é uma origem própria (o proxy pode ter trocado o Host)", () => {
      const ownHosts = ["crmsup-web:3000", HOST];

      expect(check("/api/app-users", { origin: `https://${HOST}`, ownHosts })).toBe(false);
      expect(check("/api/app-users", { origin: "https://painel.exemplo.com", ownHosts })).toBe(true);
    });

    it("sem saber o próprio host, um Origin presente é recusado", () => {
      expect(check("/api/app-users", { origin: `https://${HOST}`, ownHosts: [null, undefined] })).toBe(true);
    });

    it("origem sem host nunca é a do app, nem com um host próprio vazio", () => {
      expect(check("/api/app-users", { origin: "file://", ownHosts: [""] })).toBe(true);
      expect(check("/api/app-users", { origin: "file:///C:/pagina.html", ownHosts: ["", HOST] })).toBe(true);
    });

    it("cabeçalho vazio não é cabeçalho presente: cai no Origin, e sem Origin passa", () => {
      expect(check("/api/app-users", { secFetchSite: "", origin: "https://atacante.test" })).toBe(true);
      expect(check("/api/app-users", { secFetchSite: "", origin: "" })).toBe(false);
    });
  });

  it("sem nenhum dos dois cabeçalhos não é navegador (curl, outro servidor): segue para a checagem de sessão", () => {
    expect(check("/api/app-users")).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("vale para toda escrita (%s)", (method) => {
    expect(check("/api/app-users", { method, secFetchSite: "same-site" })).toBe(true);
  });

  // O servidor HTTP só entrega método em maiúsculas. O que vier diferente não é
  // leitura conhecida, e cai do lado da recusa.
  it.each(["PROPFIND", "get", "Head", ""])("método que não é GET, HEAD ou OPTIONS conta como escrita (`%s`)", (method) => {
    expect(check("/api/app-users", { method, secFetchSite: "same-site" })).toBe(true);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("leitura não é barrada (%s): imagem, link e navegação seguem", (method) => {
    expect(check("/api/chat/media/abc", { method, secFetchSite: "cross-site" })).toBe(false);
    expect(check("/api/chat/media/abc", { method, origin: "https://atacante.test" })).toBe(false);
  });

  it.each([
    "/api/app-users",
    "/api/connection/agent/signing-secret",
    "/api/chat/conversations/1/send",
    // Login e definir senha são da tela, e definir senha confia só no cookie.
    "/api/auth/login",
    "/api/auth/definir-senha",
    // Parecidas com as isentas, mas não são elas.
    "/api/v1",
    "/api/v10/tickets",
    "/api/chat/webhookx/uazapi",
    // O prefixo isento no meio do caminho não isenta.
    "/api/tickets/api/v1/tickets",
    "/api/contacts/api/chat/webhook/uazapi",
    // O prefixo isento tem de vir escrito assim mesmo.
    "/api/v%31/tickets",
    "/API/V1/tickets",
    // Caminho com `%` não é isento: `..` codificado começa com o prefixo isento,
    // e a trava não depende de o roteador não o decodificar.
    "/api/v1/..%2fapp-users",
    "/api/v1/%2e%2e%2fapp-users",
    "/api/chat/webhook/..%2F..%2Fapp-users",
    "/api/v1/tickets/%23123/comments",
    // Não depende de o caminho parecer de /api: o proxy lê `/%61pi/` como veio,
    // e página não recebe escrita.
    "/%61pi/app-users",
    "/%61pi/v1/tickets",
    "/app/chat",
    "/login",
    "/",
  ])("cobre %s", (pathname) => {
    expect(check(pathname, { secFetchSite: "same-site" })).toBe(true);
    expect(check(pathname, { origin: "https://atacante.test" })).toBe(true);
  });

  it.each([
    ["/api/chat/webhook/uazapi", "a uazapi chama de fora, com segredo próprio"],
    ["/api/v1/tickets", "integradores chamam de fora, com token"],
    ["/api/v1/tickets/1/messages", "em qualquer profundidade"],
  ])("não se aplica a %s (%s)", (pathname) => {
    expect(check(pathname, { secFetchSite: "cross-site" })).toBe(false);
    expect(check(pathname, { origin: "https://atacante.test" })).toBe(false);
  });

  it("página segue abrindo vinda de outro site: navegar é leitura", () => {
    expect(check("/login", { method: "GET", secFetchSite: "cross-site" })).toBe(false);
    expect(check("/app/chat", { method: "GET", secFetchSite: "cross-site" })).toBe(false);
  });
});
