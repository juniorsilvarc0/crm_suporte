import { describe, it, expect } from "vitest";

import { decideRouteAccess, isPublicApiRoute } from "@/lib/auth/route-guard";

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
    });

    it("reconhece rotas internas como não-públicas", () => {
      expect(isPublicApiRoute("/api/contacts")).toBe(false);
      expect(isPublicApiRoute("/api/tags")).toBe(false);
      expect(isPublicApiRoute("/api/internal/meta/dispatch")).toBe(false);
      expect(isPublicApiRoute("/api/integracao/leads")).toBe(false);
    });
  });
});
